/**
 * RenderService - Manages video rendering queue and FFmpeg processes
 * 
 * Features:
 * - Queue management (sequential/parallel processing)
 * - Real-time progress tracking with ETA
 * - Pause/Resume/Stop controls
 * - Error handling and recovery
 * - Preset-based FFmpeg command building
 * - Audio parameter validation to prevent FFmpeg errors
 */

import { invoke } from '@tauri-apps/api/tauri';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { detectFpsForRender } from '../utils/ffmpeg';
import { 
  validateForRender, 
  hasActiveFilters,
  getCodecConstraints,
  getValidSampleRate,
  getValidChannels,
  clampBitrate
} from '../utils/audioValidation';
import { validateVideoSettings } from '../utils/videoValidation';
import type {
  VideoSettings,
  AudioSettings,
  WatermarkSettings,
  MainScreenSettings,
} from '../types';
import StatisticsService from './StatisticsService';
import RenderScheduler, { RenderMode, RenderSlot } from './RenderScheduler';

// ============================================================================
// Types
// ============================================================================

export type RenderStatus = 'pending' | 'processing' | 'completed' | 'error' | 'paused' | 'stopped';

export interface RenderJob {
  id: string;
  inputPath: string;
  outputPath: string;
  fileName: string;
  inputSize: string; // Source file size (e.g., "120.3 MB")
  inputSizeBytes: number; // Source size in bytes for comparisons
  status: RenderStatus;
  progress: number;
  eta: number; // seconds
  etaFormatted: string;
  error?: string;
  startTime?: number;
  endTime?: number;
  durationSeconds: number;
  currentTime: number;
  fps: number;
  speed: number;
  bitrate: string;
  frame: number;
  outputSize: string; // Current output file size (e.g., "12.5 MB")
  outputSizeBytes: number; // Size in bytes for calculations
  estimatedFinalSize?: string; // Estimated final size (e.g., "~50.2 MB")
  estimatedFinalSizeBytes?: number; // Estimated final size in bytes
  assignedSlot?: 'cpu' | 'gpu'; // Which slot was used for this render
  trimStartSec: number; // Start point for trim (seconds)
  trimEndSec: number; // End point for trim (seconds)
  targetFormat?: 'video' | 'gif';
  sourceExtension?: string;
  targetExtension?: string;
}

export interface RenderProgress {
  job_id: string;
  frame: number;
  fps: number;
  bitrate: string;
  total_size: string;
  time_seconds: number;
  speed: number;
  progress_percent: number;
  eta_seconds: number;
}

export interface RenderResult {
  job_id: string;
  success: boolean;
  error?: string;
  output_path: string;
}

export interface RenderQueueState {
  jobs: RenderJob[];
  isProcessing: boolean;
  isPaused: boolean;
  currentJobId: string | null;
  renderMode: RenderMode;
  gpuAvailable: boolean;
}

export type RenderEventCallback = (jobs: RenderJob[]) => void;

export interface JobProgressData {
  jobId: string;
  progress: number;
  fps: number;
  speed: number;
  bitrate: string;
  eta: number;
  etaFormatted: string;
  currentTime: number;
  frame: number;
  outputSize: string;
  estimatedFinalSize?: string;
}

export type JobProgressCallback = (data: JobProgressData) => void;
export type ProcessingChangeCallback = (isProcessing: boolean) => void;

// ============================================================================
// FFmpeg Command Builder
// ============================================================================

export class FFmpegCommandBuilder {
  private videoSettings: VideoSettings;
  private audioSettings: AudioSettings;
  private watermarkSettings?: WatermarkSettings;
  private preferGpu: boolean;
  private outputPath: string;

  constructor(
    videoSettings: VideoSettings,
    audioSettings: AudioSettings,
    watermarkSettings?: WatermarkSettings,
    preferGpu: boolean = false,
    outputPath: string = ''
  ) {
    this.videoSettings = videoSettings;
    this.audioSettings = audioSettings;
    this.watermarkSettings = watermarkSettings;
    this.preferGpu = preferGpu;
    this.outputPath = outputPath;
  }

  /**
   * Build FFmpeg arguments array from settings
   */
  buildArgs(): string[] {
    const isGif = this.videoSettings.targetFormat === 'gif' || (this.outputPath && this.outputPath.toLowerCase().endsWith('.gif'));
    if (isGif) {
      return this.buildGifArgs();
    }

    const args: string[] = [];
    const videoFilters: string[] = [];
    const audioFilters: string[] = [];

    // ========== VIDEO SETTINGS ==========
    
    // Video codec
    if (this.videoSettings.codec === 'copy') {
      args.push('-c:v', 'copy');
    } else {
      // Hardware-accelerated decoding (HW decoding on input)
      const hwaccel = this.videoSettings.hwaccel || 'auto';
      if (hwaccel !== 'disabled') {
        args.push('-hwaccel', hwaccel);
      }

      // Determine encoder based on mode (CPU vs GPU)
      const encoder = this.getVideoEncoder();
      const isNvenc = encoder.includes('nvenc');
      
      args.push('-c:v', encoder);

      // Add encoder-specific quality/bitrate parameters
      this.addEncoderQualityParams(args, encoder, isNvenc);

      // Add encoder-specific preset
      this.addEncoderPreset(args, encoder, isNvenc);

      // FPS (support any custom FPS value up to 1000)
      if (!this.videoSettings.fpsAuto && this.videoSettings.fps) {
        const parsed = parseFloat(this.videoSettings.fps);
        if (!isNaN(parsed) && parsed > 0) {
          const fpsValue = Math.max(0.1, Math.min(1000, parsed));
          args.push('-r', fpsValue.toString());
        }
      }

      // Keyframe interval (GOP) optimization
      if (this.videoSettings.gopSize && this.videoSettings.gopSize !== 'auto') {
        const fpsNum = (!this.videoSettings.fpsAuto && this.videoSettings.fps)
          ? parseFloat(this.videoSettings.fps)
          : 30;
        let gopFrames = 60;
        if (this.videoSettings.gopSize === '1s') gopFrames = Math.max(1, Math.round(fpsNum * 1));
        else if (this.videoSettings.gopSize === '2s') gopFrames = Math.max(1, Math.round(fpsNum * 2));
        else if (this.videoSettings.gopSize === '5s') gopFrames = Math.max(1, Math.round(fpsNum * 5));
        else if (this.videoSettings.gopSize === '10s') gopFrames = Math.max(1, Math.round(fpsNum * 10));
        else {
          const parsed = parseInt(this.videoSettings.gopSize, 10);
          if (!isNaN(parsed) && parsed > 0) gopFrames = parsed;
        }
        args.push('-g', gopFrames.toString());
      }

      // Resolution - NVENC requires dimensions divisible by 2
      if (!this.videoSettings.aspectRatioAuto &&
          this.videoSettings.resolution &&
          this.videoSettings.resolution !== 'original' &&
          this.videoSettings.resolution !== 'source') {
        const [width, height] = this.videoSettings.resolution.split('x').map(Number);
        // Ensure dimensions are even (required for most encoders, especially NVENC)
        const evenWidth = Math.floor(width / 2) * 2;
        const evenHeight = Math.floor(height / 2) * 2;
        videoFilters.push(`scale=${evenWidth}:${evenHeight}`);
      }

      // Speed/tempo adjustment
      if (this.videoSettings.speed && this.videoSettings.speed !== 1.0) {
        const pts = 1 / this.videoSettings.speed;
        videoFilters.push(`setpts=${pts.toFixed(4)}*PTS`);
        // Also adjust audio tempo
        audioFilters.push(`atempo=${this.videoSettings.speed}`);
      }

      // Resampling (frame interpolation) using minterpolate
      if (this.videoSettings.resamplingEnabled) {
        // Target FPS: use selected fps value (or fallback to 60), and clamp to 120 for filter
        const requestedFps = !this.videoSettings.fpsAuto && this.videoSettings.fps
          ? Math.max(1, Math.min(240, parseFloat(this.videoSettings.fps)))
          : 60;
        const targetFpsForFilter = Math.min(requestedFps, 120);
        const intensity = Math.max(1, Math.min(10, this.videoSettings.resamplingIntensity ?? 5));
        let mi: string;
        if (intensity <= 3) {
          // Very fast motion blur-like blending (scd not needed for blend mode)
          mi = `minterpolate=fps=${targetFpsForFilter}:mi_mode=blend`;
        } else if (intensity <= 6) {
          // MCI with bilateral motion search + fast Diamond Search for speed optimization
          mi = `minterpolate=fps=${targetFpsForFilter}:mi_mode=mci:me_mode=bilat:me=ds:mb_size=16:search_param=4:scd_threshold=40`;
        } else {
          // MCI with bidir motion search + fast Diamond Search for better quality with optimization
          mi = `minterpolate=fps=${targetFpsForFilter}:mi_mode=mci:me_mode=bidir:me=ds:mb_size=16:search_param=4:scd_threshold=40`;
        }
        videoFilters.push(mi);
      }

      // Rotation
      if (this.videoSettings.rotation && this.videoSettings.rotation !== 'none') {
        const rotationMap: Record<string, string> = {
          '90': 'transpose=1',
          '180': 'transpose=1,transpose=1',
          '270': 'transpose=2',
        };
        if (rotationMap[this.videoSettings.rotation]) {
          videoFilters.push(rotationMap[this.videoSettings.rotation]);
        }
      }

      // Video filters from settings
      if (this.videoSettings.filters) {
        for (const filter of this.videoSettings.filters) {
          if (filter.enabled) {
            switch (filter.name) {
              case 'deinterlace':
                videoFilters.push('yadif');
                break;
              case 'denoise':
                videoFilters.push('hqdn3d=4:3:6:4.5');
                break;
              case 'sharpen':
                videoFilters.push('unsharp=5:5:1.0:5:5:0.0');
                break;
            }
          }
        }
      }
      
      // Ensure pixel format compatibility
      const codec = this.videoSettings.codec.toLowerCase();
      if (codec === 'h264' || codec === 'h265' || codec === 'hevc' || codec === 'av1' || codec === 'vp9') {
        const pixFmt = this.videoSettings.pixelFormat || 'yuv420p';
        videoFilters.push(`format=${pixFmt}`);
      }
    }

    // ========== WATERMARK ==========
    
    if (this.watermarkSettings?.enabled && 
        this.watermarkSettings.imagePath &&
        this.videoSettings.codec !== 'copy') {
      console.log('[FFmpegCommandBuilder] Watermark enabled:', this.watermarkSettings.position);
    }

    // ========== AUDIO SETTINGS (with validation) ==========
    
    // Validate audio settings before building command
    const audioValidation = validateForRender(this.audioSettings);
    if (!audioValidation.valid) {
      console.error('[FFmpegCommandBuilder] Audio validation failed:', audioValidation.error);
      // Fall back to safe defaults
    }
    
    // Use validated settings
    const validatedAudio = audioValidation.settings;
    const filtersActive = hasActiveFilters(validatedAudio);
    
    // CRITICAL: If filters are active, we CANNOT use copy codec
    if (validatedAudio.codec === 'copy' && !filtersActive) {
      args.push('-c:a', 'copy');
      console.log('[FFmpegCommandBuilder] Audio: copy stream (no filters)');
    } else {
      // Get codec-specific constraints
      const constraints = getCodecConstraints(validatedAudio.codec);
      
      // If copy was selected but filters are active, force re-encoding
      if (validatedAudio.codec === 'copy' && filtersActive) {
        console.warn('[FFmpegCommandBuilder] Filters active with copy codec, forcing AAC encoder');
        args.push('-c:a', 'aac');
        args.push('-b:a', '192k');
        args.push('-ac', '2');
        args.push('-ar', '48000');
      } else {
        // Use the correct encoder for the codec
        args.push('-c:a', constraints.encoderName);
        
        // Sample rate - use validated value (critical for Opus: 48kHz, MP3: 44.1kHz)
        const sampleRate = getValidSampleRate(
          parseInt(validatedAudio.sampleRate, 10),
          constraints
        );
        args.push('-ar', sampleRate.toString());
        console.log(`[FFmpegCommandBuilder] Audio sample rate: ${sampleRate}Hz (codec: ${validatedAudio.codec})`);
        
        // Channels - use validated value (Opus/MP3: 1-2 only)
        const channels = getValidChannels(
          parseInt(validatedAudio.channels, 10),
          constraints
        );
        args.push('-ac', channels.toString());
        console.log(`[FFmpegCommandBuilder] Audio channels: ${channels} (codec: ${validatedAudio.codec})`);
        
        // Bitrate - use validated value (Opus: 16-128k, MP3: 64-192k)
        if (constraints.bitrateOptions.length > 0 && validatedAudio.bitrate) {
          const bitrate = clampBitrate(
            parseInt(validatedAudio.bitrate, 10),
            constraints
          );
          args.push('-b:a', `${bitrate}k`);
          console.log(`[FFmpegCommandBuilder] Audio bitrate: ${bitrate}k (codec: ${validatedAudio.codec})`);
        }
      }

      // Volume adjustment (clamp to valid range 0.0 - 10.0)
      if (validatedAudio.volume && validatedAudio.volume !== '100') {
        const volumeFloat = Math.max(0, Math.min(10, parseFloat(validatedAudio.volume) / 100));
        if (volumeFloat !== 1.0) {
          audioFilters.push(`volume=${volumeFloat.toFixed(2)}`);
        }
      }

      // Gain (clamp to valid range -20dB to +20dB)
      if (validatedAudio.gain && validatedAudio.gain !== '0') {
        const gainValue = Math.max(-20, Math.min(20, parseFloat(validatedAudio.gain)));
        if (gainValue !== 0) {
          audioFilters.push(`volume=${gainValue}dB`);
        }
      }

      // Normalization - ONLY if not using copy codec
      if (validatedAudio.normalization && validatedAudio.codec !== 'copy') {
        audioFilters.push('loudnorm=I=-16:LRA=11:TP=-1.5');
        console.log('[FFmpegCommandBuilder] Audio normalization enabled (loudnorm)');
      }

      // Pitch shift without changing speed (rubberband, semitones -> ratio)
      if (validatedAudio.pitch && validatedAudio.pitch !== 0) {
        const semitones = Math.max(-12, Math.min(12, validatedAudio.pitch));
        const pitchFactor = Math.pow(2, semitones / 12);
        audioFilters.push(`rubberband=pitch=${pitchFactor.toFixed(6)}`);
      }

      // Noise reduction using afftdn filter
      // nf (noise floor) must be in range -80 to -20 dB
      if (validatedAudio.noiseReduction && 
          parseFloat(validatedAudio.noiseReduction) > 0) {
        const nrLevel = Math.max(0, Math.min(1, parseFloat(validatedAudio.noiseReduction)));
        const noiseFloor = Math.round(-80 + (nrLevel * 60));
        const clampedNf = Math.max(-80, Math.min(-20, noiseFloor));
        audioFilters.push(`afftdn=nf=${clampedNf}`);
      }

      // Equalizer
      if (validatedAudio.equalizer) {
        const eqParts: string[] = [];
        for (const band of validatedAudio.equalizer) {
          if (band.gain !== 0) {
            eqParts.push(`equalizer=f=${band.frequency}:width_type=o:width=2:g=${band.gain}`);
          }
        }
        if (eqParts.length > 0) {
          audioFilters.push(...eqParts);
        }
      }

      // Audio effects
      if (validatedAudio.effects) {
        for (const effect of validatedAudio.effects) {
          if (effect.enabled) {
            switch (effect.name) {
              case 'reverb':
                audioFilters.push('aecho=0.8:0.9:1000:0.3');
                break;
              case 'chorus':
                audioFilters.push('chorus=0.5:0.9:50:0.4:0.25:2');
                break;
              case 'compressor':
                audioFilters.push('acompressor=threshold=0.5:ratio=4:attack=5:release=50');
                break;
            }
          }
        }
      }
    }

    // ========== APPLY FILTERS ==========
    
    if (videoFilters.length > 0 && this.videoSettings.codec !== 'copy') {
      const vfStr = videoFilters.join(',');
      console.log('[FFmpegCommandBuilder] Final -vf:', vfStr);
      args.push('-vf', vfStr);
    }

    if (audioFilters.length > 0 && this.audioSettings.codec !== 'copy') {
      args.push('-af', audioFilters.join(','));
    }

    // Movflags for web compatibility - ONLY for MP4/MOV/M4V containers
    // Using this flag with WebM/MKV causes "Option not found" error
    if (this.outputPath) {
      const ext = this.outputPath.toLowerCase().split('.').pop() || '';
      const supportsMovflags = ['mp4', 'mov', 'm4v', 'm4a'].includes(ext);
      if (supportsMovflags) {
        args.push('-movflags', '+faststart');
      }
    } else {
      // Fallback: check codec to guess container
      // VP9/VP8/AV1 typically use WebM which doesn't support movflags
      const codec = this.videoSettings.codec.toLowerCase();
      const isWebmCodec = ['vp9', 'vp8', 'av1'].includes(codec);
      if (!isWebmCodec) {
        args.push('-movflags', '+faststart');
      }
    }

    return args;
  }

  /**
   * Build high-quality palette-based FFmpeg arguments for animated GIF
   */
  private buildGifArgs(): string[] {
    const args: string[] = [];
    const gifSettings = this.videoSettings.gifSettings || { fps: '15', width: '480', dither: 'bayer', loop: 0 };
    const fps = gifSettings.fps || '15';
    const width = gifSettings.width || '480';
    const dither = gifSettings.dither || 'bayer';
    const loop = (gifSettings.loop ?? 0).toString();

    const preFilters: string[] = [];
    if (fps) {
      preFilters.push(`fps=${fps}`);
    }

    if (width !== 'original' && width !== 'source') {
      const w = parseInt(width, 10);
      if (!isNaN(w) && w > 0) {
        const evenWidth = Math.floor(w / 2) * 2;
        preFilters.push(`scale=${evenWidth}:-2:flags=lanczos`);
      }
    }

    // Rotation
    if (this.videoSettings.rotation && this.videoSettings.rotation !== 'none') {
      const rotationMap: Record<string, string> = {
        '90': 'transpose=1',
        '180': 'transpose=1,transpose=1',
        '270': 'transpose=2',
      };
      if (rotationMap[this.videoSettings.rotation]) {
        preFilters.push(rotationMap[this.videoSettings.rotation]);
      }
    }

    // Flip
    if (this.videoSettings.flip === 'horizontal') {
      preFilters.push('hflip');
    } else if (this.videoSettings.flip === 'vertical') {
      preFilters.push('vflip');
    }

    // Speed
    if (this.videoSettings.speed && this.videoSettings.speed !== 1.0) {
      const pts = 1 / this.videoSettings.speed;
      preFilters.push(`setpts=${pts.toFixed(4)}*PTS`);
    }

    const preFilterStr = preFilters.length > 0 ? `${preFilters.join(',')},` : '';

    let paletteUseOpts = 'diff_mode=rectangle';
    if (dither === 'bayer') {
      paletteUseOpts += ':dither=bayer:bayer_scale=3';
    } else if (dither === 'floyd_steinberg') {
      paletteUseOpts += ':dither=floyd_steinberg';
    } else if (dither === 'none') {
      paletteUseOpts += ':dither=none';
    }

    const filterComplex = `[0:v] ${preFilterStr}split [a][b];[a] palettegen=stats_mode=diff [p];[b][p] paletteuse=${paletteUseOpts}`;

    args.push('-filter_complex', filterComplex);
    args.push('-loop', loop);
    args.push('-an');

    return args;
  }

  /**
   * Get the video encoder name based on codec and GPU preference
   */
  private getVideoEncoder(): string {
    // Map codec names to FFmpeg encoders (CPU)
    const cpuCodecMap: Record<string, string> = {
      'h264': 'libx264',
      'h265': 'libx265',
      'hevc': 'libx265',
      'vp9': 'libvpx-vp9',
      'vp8': 'libvpx',
      'av1': 'libaom-av1',
      'mpeg4': 'mpeg4',
      'prores': 'prores_ks',
    };

    // GPU (NVENC) encoders for supported codecs
    const gpuCodecMap: Record<string, string> = {
      'h264': 'h264_nvenc',
      'h265': 'hevc_nvenc',
      'hevc': 'hevc_nvenc',
    };

    if (this.preferGpu) {
      const gpuEncoder = gpuCodecMap[this.videoSettings.codec];
      if (!gpuEncoder) {
        console.warn(`[FFmpegCommandBuilder] GPU not supported for codec ${this.videoSettings.codec}, falling back to CPU`);
        return cpuCodecMap[this.videoSettings.codec] || this.videoSettings.codec;
      }
      return gpuEncoder;
    }

    return cpuCodecMap[this.videoSettings.codec] || this.videoSettings.codec;
  }

  /**
   * Add encoder-specific quality/bitrate parameters
   * CPU (libx264/libx265): uses -crf for quality or -b:v
   * GPU (NVENC): uses -cq / -rc constqp (constant quality) or -rc vbr (bitrate mode)
   */
  private addEncoderQualityParams(args: string[], encoder: string, isNvenc: boolean): void {
    const rateControl = this.videoSettings.rateControlMode || 'crf';
    const crfValue = Math.max(0, Math.min(51, parseInt(this.videoSettings.crf || '23', 10)));
    const bitrateValue = Math.max(0.1, Math.min(200, parseFloat(this.videoSettings.bitrate || '5')));
    const maxrateValue = this.videoSettings.maxrate ? parseFloat(this.videoSettings.maxrate) : (bitrateValue * 1.5);
    const bufsizeValue = this.videoSettings.bufsize ? parseFloat(this.videoSettings.bufsize) : (bitrateValue * 3);

    if (isNvenc) {
      if (rateControl === 'crf') {
        // NVENC Constant Quality mode without forcing any target bitrate
        args.push('-rc', 'constqp');
        args.push('-cq', crfValue.toString());
        args.push('-qp', crfValue.toString());
      } else if (rateControl === 'constrained_crf') {
        // NVENC CQ with bitrate cap
        args.push('-rc', 'vbr');
        args.push('-cq', crfValue.toString());
        args.push('-qmin', crfValue.toString());
        args.push('-qmax', Math.min(51, crfValue + 6).toString());
        args.push('-b:v', '0');
        args.push('-maxrate', `${maxrateValue.toFixed(1)}M`);
        args.push('-bufsize', `${bufsizeValue.toFixed(0)}M`);
      } else if (rateControl === 'cbr') {
        args.push('-rc', 'cbr');
        args.push('-b:v', `${bitrateValue}M`);
        args.push('-minrate', `${bitrateValue}M`);
        args.push('-maxrate', `${bitrateValue}M`);
        args.push('-bufsize', `${(bitrateValue * 2).toFixed(0)}M`);
      } else {
        // VBR mode
        args.push('-rc', 'vbr');
        args.push('-b:v', `${bitrateValue}M`);
        args.push('-maxrate', `${maxrateValue.toFixed(1)}M`);
        args.push('-bufsize', `${bufsizeValue.toFixed(0)}M`);
      }

      // NVENC-specific AQ optimizations
      if (this.videoSettings.spatialAq !== false) {
        args.push('-spatial-aq', '1');
      }
      if (this.videoSettings.temporalAq !== false) {
        args.push('-temporal-aq', '1');
      }
      if (this.videoSettings.nvencMultipass === 'fullres') {
        args.push('-multipass', 'fullres');
      }
      if (this.videoSettings.bFrames !== undefined) {
        // NVENC hardware encoder limit is strictly max 4 B-frames
        const nvencBf = Math.max(0, Math.min(4, this.videoSettings.bFrames));
        args.push('-bf', nvencBf.toString());
        if (nvencBf >= 2) {
          args.push('-b_ref_mode', 'middle');
        }
      }

    } else {
      // CPU encoders (libx264, libx265, libvpx-vp9, libaom-av1)
      const isVp9OrAv1 = encoder.includes('vpx') || encoder.includes('aom') || encoder.includes('svtav1');

      if (rateControl === 'crf') {
        args.push('-crf', crfValue.toString());
        if (isVp9OrAv1) {
          args.push('-b:v', '0');
        }
      } else if (rateControl === 'constrained_crf') {
        args.push('-crf', crfValue.toString());
        args.push('-maxrate', `${maxrateValue.toFixed(1)}M`);
        args.push('-bufsize', `${bufsizeValue.toFixed(0)}M`);
      } else if (rateControl === 'cbr') {
        args.push('-b:v', `${bitrateValue}M`);
        args.push('-minrate', `${bitrateValue}M`);
        args.push('-maxrate', `${bitrateValue}M`);
        args.push('-bufsize', `${(bitrateValue * 2).toFixed(0)}M`);
      } else {
        // VBR
        args.push('-b:v', `${bitrateValue}M`);
        if (this.videoSettings.maxrate) {
          args.push('-maxrate', `${maxrateValue.toFixed(1)}M`);
          args.push('-bufsize', `${bufsizeValue.toFixed(0)}M`);
        }
      }

      // CPU AQ mode & B-frames
      if (encoder === 'libx264' || encoder === 'libx265') {
        if (this.videoSettings.aqModeCpu === 'autovariance') {
          args.push('-aq-mode', '2');
        } else if (this.videoSettings.aqModeCpu === 'darkscenes') {
          args.push('-aq-mode', '3');
        } else if (this.videoSettings.aqModeCpu === 'variance') {
          args.push('-aq-mode', '1');
        }
        if (this.videoSettings.bFrames !== undefined && this.videoSettings.bFrames > 0) {
          args.push('-bf', this.videoSettings.bFrames.toString());
        }
      }
    }
  }

  /**
   * Add encoder-specific preset and tuning
   */
  private addEncoderPreset(args: string[], encoder: string, isNvenc: boolean): void {
    const preset = this.videoSettings.preset;

    if (isNvenc) {
      // Map CPU presets to NVENC presets: p1 (fastest) to p7 (slowest/best quality)
      const nvencPresetMap: Record<string, string> = {
        'ultrafast': 'p1',
        'superfast': 'p2',
        'veryfast': 'p3',
        'faster': 'p4',
        'fast': 'p4',
        'medium': 'p5',
        'slow': 'p6',
        'slower': 'p7',
        'veryslow': 'p7',
        'placebo': 'p7',
        'p1': 'p1', 'p2': 'p2', 'p3': 'p3', 'p4': 'p4',
        'p5': 'p5', 'p6': 'p6', 'p7': 'p7',
      };
      
      const nvencPreset = (preset && nvencPresetMap[preset.toLowerCase()]) || 'p4';
      args.push('-preset', nvencPreset);
      
      // Set tuning for NVENC (hq = high quality, ll = low latency)
      const tune = this.videoSettings.tune;
      if (tune === 'zerolatency' || tune === 'fastdecode') {
        args.push('-tune', 'll');
      } else {
        args.push('-tune', 'hq');
      }
      
    } else if (encoder === 'libx264' || encoder === 'libx265') {
      // CPU presets
      const validPresets = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo'];
      const cpuPreset = (preset && validPresets.includes(preset.toLowerCase())) ? preset.toLowerCase() : 'medium';
      args.push('-preset', cpuPreset);

      // CPU Tuning
      if (this.videoSettings.tune && this.videoSettings.tune !== 'none') {
        const validCpuTunes = ['film', 'animation', 'grain', 'stillimage', 'fastdecode', 'zerolatency'];
        if (validCpuTunes.includes(this.videoSettings.tune)) {
          args.push('-tune', this.videoSettings.tune);
        }
      }
    }
  }

  /**
   * Validate settings compatibility and parameter ranges
   */
  validate(): { valid: boolean; errors: string[]; warnings: string[] } {
    if (this.videoSettings.targetFormat === 'gif' || (this.outputPath && this.outputPath.toLowerCase().endsWith('.gif'))) {
      return { valid: true, errors: [], warnings: [] };
    }

    const videoVal = validateVideoSettings(this.videoSettings, this.preferGpu);
    const errors: string[] = [...videoVal.errors];
    const warnings: string[] = [...videoVal.warnings];

    // Copy codec doesn't support filters
    if (this.videoSettings.codec === 'copy') {
      if (this.videoSettings.filters?.some(f => f.enabled)) {
        errors.push('Video filters not supported with codec "copy"');
      }
      if (this.videoSettings.rotation !== 'none') {
        errors.push('Rotation not supported with codec "copy"');
      }
      if (this.videoSettings.flip !== 'none') {
        if (this.videoSettings.resamplingEnabled) {
          errors.push('Resampling not supported with codec "copy"');
        }
        errors.push('Flip not supported with codec "copy"');
      }
      if (this.watermarkSettings?.enabled) {
        errors.push('Watermark not supported with codec "copy"');
      }
    }

    if (this.audioSettings.codec === 'copy') {
      if (this.audioSettings.normalization) {
        errors.push('Audio normalization not supported with codec "copy"');
      }
      if (this.audioSettings.effects?.some(e => e.enabled)) {
        errors.push('Audio effects not supported with codec "copy"');
      }
    }

    // Validate audio parameters
    if (this.audioSettings.bitrate && this.audioSettings.bitrate !== 'auto') {
      const bitrate = parseInt(this.audioSettings.bitrate, 10);
      if (isNaN(bitrate) || bitrate < 32 || bitrate > 512) {
        warnings.push(`Audio bitrate ${this.audioSettings.bitrate}k is outside recommended range (32-512), will be clamped`);
      }
    }

    if (this.audioSettings.volume) {
      const volume = parseFloat(this.audioSettings.volume);
      if (isNaN(volume) || volume < 0 || volume > 1000) {
        warnings.push(`Volume ${this.audioSettings.volume}% is outside safe range (0-1000), will be clamped`);
      }
    }

    if (this.audioSettings.noiseReduction) {
      const nr = parseFloat(this.audioSettings.noiseReduction);
      if (isNaN(nr) || nr < 0 || nr > 1) {
        warnings.push(`Noise reduction ${this.audioSettings.noiseReduction} is outside valid range (0-1), will be clamped`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Get human-readable description of settings
   */
  getSettingsDescription(): string {
    if (this.videoSettings.targetFormat === 'gif' || (this.outputPath && this.outputPath.toLowerCase().endsWith('.gif'))) {
      const gs = this.videoSettings.gifSettings || { fps: '15', width: '480', dither: 'bayer' };
      return `GIF (${gs.fps || '15'} fps, ${gs.width || '480'}px, dither: ${gs.dither || 'bayer'})`;
    }

    const parts: string[] = [];
    
    // Show actual encoder being used
    const encoder = this.videoSettings.codec === 'copy' ? 'copy' : this.getVideoEncoder();
    const isNvenc = encoder.includes('nvenc');
    
    parts.push(`Video: ${encoder}${isNvenc ? ' (GPU)' : ''}`);
    
    if (this.videoSettings.codec !== 'copy') {
      if (this.videoSettings.bitrate && this.videoSettings.bitrate !== 'auto') {
        parts.push(`${this.videoSettings.bitrate}Mbps`);
      }
      if (this.videoSettings.crf && this.videoSettings.crf !== 'auto') {
        // Show CQ for NVENC, CRF for CPU
        parts.push(`${isNvenc ? 'CQ' : 'CRF'} ${this.videoSettings.crf}`);
      }
      if (this.videoSettings.preset) {
        parts.push(`preset: ${this.videoSettings.preset}`);
      }
      if (this.videoSettings.hwaccel && this.videoSettings.hwaccel !== 'disabled') {
        parts.push(`HW Dec: ${this.videoSettings.hwaccel}`);
      }
    }
    
    parts.push(`Audio: ${this.audioSettings.codec}`);
    if (this.audioSettings.bitrate && this.audioSettings.bitrate !== 'auto') {
      parts.push(`${this.audioSettings.bitrate}kbps`);
    }
    
    return parts.join(', ');
  }
}

// ============================================================================
// Render Service (Singleton)
// ============================================================================

class RenderServiceImpl {
  private jobs: Map<string, RenderJob> = new Map();
  private isProcessing: boolean = false;
  private isPaused: boolean = false;
  private currentJobId: string | null = null;
  private scheduler: RenderScheduler = new RenderScheduler();
  private renderMode: RenderMode = 'cpu';
  private gpuAvailable: boolean = false;
  private activeJobs: Set<string> = new Set();
  private listeners: Set<RenderEventCallback> = new Set();
  private jobProgressListeners: Map<string, Set<JobProgressCallback>> = new Map();
  private processingListeners: Set<ProcessingChangeCallback> = new Set();
  private progressThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingJobProgress: Map<string, JobProgressData> = new Map();
  private unlistenProgress: UnlistenFn | null = null;
  private unlistenComplete: UnlistenFn | null = null;
  private unlistenError: UnlistenFn | null = null;
  private unlistenStopped: UnlistenFn | null = null;

  // Current settings
  private videoSettings: VideoSettings | null = null;
  private audioSettings: AudioSettings | null = null;
  private watermarkSettings?: WatermarkSettings;
  private mainScreenSettings: MainScreenSettings | null = null;
  private outputSuffix: string = '_szhatoe';
  private selectedPresetName: string | null = null;

  private static readonly MIN_TRIM_DURATION_SEC = 1;

  constructor() {
    this.setupEventListeners();
  }

  /**
   * Setup Tauri event listeners
   */
  private async setupEventListeners(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      // Listen for progress updates
      this.unlistenProgress = await listen<RenderProgress>('render-progress', (event) => {
        this.handleProgressUpdate(event.payload);
      });

      // Listen for completion
      this.unlistenComplete = await listen<string>('render-complete', (event) => {
        this.handleJobComplete(event.payload);
      });

      // Listen for errors
      this.unlistenError = await listen<{ job_id: string; error: string }>('render-error', (event) => {
        this.handleJobError(event.payload.job_id, event.payload.error);
      });

      // Listen for stop events (new)
      const unlistenStop = await listen<{ job_id: string; stopped_by: string }>('render-stopped', (event) => {
        this.handleJobStopped(event.payload.job_id, event.payload.stopped_by);
      });
      
      // Store for cleanup
      this.unlistenStopped = unlistenStop;
    } catch (error) {
      console.error('[RenderService] Failed to setup event listeners:', error);
    }
  }

  /**
   * Cleanup event listeners
   */
  public async cleanup(): Promise<void> {
    if (this.unlistenProgress) {
      this.unlistenProgress();
    }
    if (this.unlistenComplete) {
      this.unlistenComplete();
    }
    if (this.unlistenError) {
      this.unlistenError();
    }
    if (this.unlistenStopped) {
      this.unlistenStopped();
    }
  }

  /**
   * Update settings from preset
   */
  public updateSettings(
    videoSettings: VideoSettings,
    audioSettings: AudioSettings,
    watermarkSettings?: WatermarkSettings,
    mainScreenSettings?: MainScreenSettings,
    outputSuffix?: string,
    presetName?: string
  ): void {
    const prevFormat = this.videoSettings?.targetFormat;
    this.videoSettings = videoSettings;
    this.audioSettings = audioSettings;
    this.watermarkSettings = watermarkSettings;
    this.mainScreenSettings = mainScreenSettings || this.mainScreenSettings;
    this.outputSuffix = outputSuffix || this.outputSuffix;
    this.selectedPresetName = presetName || null;

    // If targetFormat changed, update pending jobs
    if (videoSettings.targetFormat && videoSettings.targetFormat !== prevFormat) {
      for (const [id, job] of this.jobs) {
        if (job.status === 'pending') {
          const nextOutputPath = this.generateOutputPath(job.inputPath);
          const lastDot = job.fileName.lastIndexOf('.');
          const sourceExtension = lastDot > 0 ? job.fileName.substring(lastDot + 1).toLowerCase() : 'mp4';
          const isGif = videoSettings.targetFormat === 'gif' || nextOutputPath.toLowerCase().endsWith('.gif');
          const targetExtension = isGif ? 'gif' : (nextOutputPath.split('.').pop()?.toLowerCase() || 'mp4');
          job.outputPath = nextOutputPath;
          job.targetFormat = isGif ? 'gif' : 'video';
          job.sourceExtension = sourceExtension;
          job.targetExtension = targetExtension;
        }
      }
      this.notifyListeners();
    }
    
    console.log('[RenderService] Settings updated', presetName ? `(preset: ${presetName})` : '', `| fpsAuto: ${videoSettings.fpsAuto}, fps: ${videoSettings.fps}`);
  }

  /**
   * Set the current preset name for statistics tracking
   */
  public setPresetName(presetName: string | null): void {
    this.selectedPresetName = presetName;
  }

  /**
   * Set render mode (cpu | gpu | duo)
   * This is the single source of truth for render mode.
   * Atomically updates state, scheduler, persists to settings, and notifies UI.
   */
  public setRenderMode(mode: RenderMode): void {
    // If GPU requested but unavailable, fallback to CPU
    const wantsGpu = mode !== 'cpu';
    const effectiveMode: RenderMode = wantsGpu && !this.gpuAvailable ? 'cpu' : mode;
    
    // Only update if actually changed
    if (this.renderMode === effectiveMode) return;
    
    this.renderMode = effectiveMode;
    this.scheduler.setMode(effectiveMode);
    
    console.log('[RenderService] Render mode set to:', effectiveMode, '(requested:', mode, ', gpuAvailable:', this.gpuAvailable, ')');
    
    // Notify UI subscribers immediately
    this.notifyListeners();
    
    // Save to settings (async, don't block)
    invoke('save_render_mode', { mode: effectiveMode }).catch(err => {
      console.error('[RenderService] Failed to save render mode:', err);
    });
  }

  /**
   * Update GPU availability (from settings check)
   * Atomically updates state, scheduler, and notifies UI.
   * If GPU becomes unavailable, forces CPU mode.
   */
  public setGpuAvailability(available: boolean): void {
    // Only update if actually changed
    if (this.gpuAvailable === available) return;
    
    this.gpuAvailable = available;
    this.scheduler.setGpuAvailable(available);
    
    console.log('[RenderService] GPU availability set to:', available);
    
    // If GPU just became unavailable and we're in GPU/duo mode, force CPU
    if (!available && this.renderMode !== 'cpu') {
      this.renderMode = 'cpu';
      this.scheduler.setMode('cpu');
      console.log('[RenderService] GPU unavailable, forced CPU mode');
    }
    
    // Notify UI subscribers immediately
    this.notifyListeners();
  }

  /**
   * Subscribe to queue updates (structural changes, statuses)
   */
  public subscribe(callback: RenderEventCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Subscribe to high-frequency progress updates for a single job
   */
  public subscribeJobProgress(jobId: string, callback: JobProgressCallback): () => void {
    if (!this.jobProgressListeners.has(jobId)) {
      this.jobProgressListeners.set(jobId, new Set());
    }
    this.jobProgressListeners.get(jobId)!.add(callback);

    // Initial snapshot if job exists
    const job = this.jobs.get(jobId);
    if (job) {
      callback({
        jobId: job.id,
        progress: job.progress,
        fps: job.fps,
        speed: job.speed,
        bitrate: job.bitrate,
        eta: job.eta,
        etaFormatted: job.etaFormatted || '--:--',
        currentTime: job.currentTime,
        frame: job.frame,
        outputSize: job.outputSize || '0 MB',
        estimatedFinalSize: job.estimatedFinalSize,
      });
    }

    return () => {
      const set = this.jobProgressListeners.get(jobId);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          this.jobProgressListeners.delete(jobId);
        }
      }
    };
  }

  /**
   * Subscribe to processing state changes (idle <-> rendering)
   */
  public subscribeProcessing(callback: ProcessingChangeCallback): () => void {
    this.processingListeners.add(callback);
    callback(this.isProcessing);
    return () => this.processingListeners.delete(callback);
  }

  /**
   * Get progress data snapshot for a specific job
   */
  public getJobProgress(jobId: string): JobProgressData | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return {
      jobId: job.id,
      progress: job.progress,
      fps: job.fps,
      speed: job.speed,
      bitrate: job.bitrate,
      eta: job.eta,
      etaFormatted: job.etaFormatted || '--:--',
      currentTime: job.currentTime,
      frame: job.frame,
      outputSize: job.outputSize || '0 MB',
      estimatedFinalSize: job.estimatedFinalSize,
    };
  }

  /**
   * Check if queue is currently processing
   */
  public isProcessingState(): boolean {
    return this.isProcessing;
  }

  /**
   * Update isProcessing flag and notify listeners if changed
   */
  private setProcessing(processing: boolean): void {
    if (this.isProcessing !== processing) {
      this.isProcessing = processing;
      this.processingListeners.forEach((callback) => {
        try {
          callback(processing);
        } catch (e) {
          console.error('[RenderService] Error in processing listener:', e);
        }
      });
    }
  }

  /**
   * Notify all queue listeners
   */
  private notifyListeners(): void {
    const jobs = Array.from(this.jobs.values());
    this.listeners.forEach(callback => callback(jobs));
  }

  /**
   * Generate output path for a file
   */
  private generateOutputPath(inputPath: string): string {
    const parts = inputPath.split(/[\\/]/);
    const fileName = parts.pop() || 'output.mp4';
    const dirPath = parts.join('/');
    
    // Get file extension
    const lastDot = fileName.lastIndexOf('.');
    const baseName = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
    let extension = lastDot > 0 ? fileName.substring(lastDot) : '.mp4';
    if (this.videoSettings?.targetFormat === 'gif') {
      extension = '.gif';
    }

    // Determine output directory
    let outputDir = dirPath;
    if (this.mainScreenSettings && !this.mainScreenSettings.saveInSourceDirectory) {
      if (this.mainScreenSettings.customOutputPath) {
        outputDir = this.mainScreenSettings.customOutputPath;
      }
    }

    return `${outputDir}/${baseName}${this.outputSuffix}${extension}`;
  }

  /**
   * Add files to render queue
   */
  public async addToQueue(filePaths: string[]): Promise<RenderJob[]> {
    const newJobs: RenderJob[] = [];

    for (const inputPath of filePaths) {
      const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const fileName = inputPath.split(/[\\/]/).pop() || inputPath;
      const outputPath = this.generateOutputPath(inputPath);

      // Get video duration
      let durationSeconds = 0;
      try {
        durationSeconds = await invoke<number>('get_video_duration', { inputPath });
      } catch (error) {
        console.warn('[RenderService] Could not get duration for:', inputPath, error);
      }

      // Get source file size for before/after comparisons
      let inputSizeBytes = 0;
      try {
        inputSizeBytes = await invoke<number>('get_file_size_bytes', { inputPath });
      } catch (error) {
        console.warn('[RenderService] Could not get file size for:', inputPath, error);
      }
      const inputSize = inputSizeBytes > 0
        ? this.parseFileSize(`${inputSizeBytes}b`).formatted
        : '—';

      const isGif = this.videoSettings?.targetFormat === 'gif' || outputPath.toLowerCase().endsWith('.gif');
      const lastDot = fileName.lastIndexOf('.');
      const sourceExtension = lastDot > 0 ? fileName.substring(lastDot + 1).toLowerCase() : 'mp4';
      const targetExtension = isGif ? 'gif' : (outputPath.split('.').pop()?.toLowerCase() || 'mp4');

      const job: RenderJob = {
        id: jobId,
        inputPath,
        outputPath,
        fileName,
        inputSize,
        inputSizeBytes,
        status: 'pending',
        progress: 0,
        eta: 0,
        etaFormatted: '--:--:--',
        durationSeconds,
        currentTime: 0,
        fps: 0,
        speed: 0,
        bitrate: '',
        frame: 0,
        outputSize: '—',
        outputSizeBytes: 0,
        trimStartSec: 0,
        trimEndSec: durationSeconds > 0 ? durationSeconds : 0,
        targetFormat: isGif ? 'gif' : 'video',
        sourceExtension,
        targetExtension,
      };

      this.jobs.set(jobId, job);
      this.scheduler.enqueue(jobId);
      newJobs.push(job);
    }

    this.notifyListeners();
    return newJobs;
  }

  /**
   * Add file to render queue with explicit output path (for re-renders)
   */
  public async addToQueueWithOutput(
    inputPath: string,
    outputPath: string,
    trimStartSec?: number,
    trimEndSec?: number,
  ): Promise<RenderJob> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fileName = inputPath.split(/[\\/]/).pop() || inputPath;

    // Get video duration
    let durationSeconds = 0;
    try {
      durationSeconds = await invoke<number>('get_video_duration', { inputPath });
    } catch (error) {
      console.warn('[RenderService] Could not get duration for:', inputPath, error);
    }

    // Get source file size for before/after comparisons
    let inputSizeBytes = 0;
    try {
      inputSizeBytes = await invoke<number>('get_file_size_bytes', { inputPath });
    } catch (error) {
      console.warn('[RenderService] Could not get file size for:', inputPath, error);
    }
    const inputSize = inputSizeBytes > 0
      ? this.parseFileSize(`${inputSizeBytes}b`).formatted
      : '—';

    const job: RenderJob = {
      id: jobId,
      inputPath,
      outputPath,
      fileName,
      inputSize,
      inputSizeBytes,
      status: 'pending',
      progress: 0,
      eta: 0,
      etaFormatted: '--:--:--',
      durationSeconds,
      currentTime: 0,
      fps: 0,
      speed: 0,
      bitrate: '',
      frame: 0,
      outputSize: '—',
      outputSizeBytes: 0,
      trimStartSec: 0,
      trimEndSec: durationSeconds > 0 ? durationSeconds : 0,
      targetFormat: (this.videoSettings?.targetFormat === 'gif' || outputPath.toLowerCase().endsWith('.gif')) ? 'gif' : 'video',
      sourceExtension: fileName.lastIndexOf('.') > 0 ? fileName.substring(fileName.lastIndexOf('.') + 1).toLowerCase() : 'mp4',
      targetExtension: (this.videoSettings?.targetFormat === 'gif' || outputPath.toLowerCase().endsWith('.gif')) ? 'gif' : (outputPath.split('.').pop()?.toLowerCase() || 'mp4'),
    };

    if (durationSeconds > 0 && typeof trimStartSec === 'number' && typeof trimEndSec === 'number') {
      const normalized = this.normalizeTrimRange(durationSeconds, trimStartSec, trimEndSec);
      job.trimStartSec = normalized.start;
      job.trimEndSec = normalized.end;
    }

    this.jobs.set(jobId, job);
    this.scheduler.enqueue(jobId);
    this.notifyListeners();
    return job;
  }

  /**
   * Update trim for a queued job.
   * Trim can only be edited while job is pending.
   */
  public updateJobTrim(jobId: string, trimStartSec: number, trimEndSec: number): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status !== 'pending') return false;
    if (job.durationSeconds <= 0) return false;

    const normalized = this.normalizeTrimRange(job.durationSeconds, trimStartSec, trimEndSec);
    if ((normalized.end - normalized.start) < RenderServiceImpl.MIN_TRIM_DURATION_SEC) {
      return false;
    }

    job.trimStartSec = normalized.start;
    job.trimEndSec = normalized.end;
    this.notifyListeners();
    return true;
  }

  /**
   * Remove job from queue
   */
  public removeFromQueue(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    // Can't remove processing job
    if (job.status === 'processing') {
      return false;
    }

    this.jobs.delete(jobId);
    this.scheduler.remove(jobId);
    this.notifyListeners();
    return true;
  }

  /**
   * Clear completed/error jobs
   */
  public clearCompleted(): void {
    const toRemove: string[] = [];
    
    this.jobs.forEach((job, id) => {
      if (job.status === 'completed' || job.status === 'error') {
        toRemove.push(id);
      }
    });

    toRemove.forEach(id => {
      this.jobs.delete(id);
      this.scheduler.remove(id);
    });

    this.notifyListeners();
  }

  /**
   * Start processing queue
   */
  public async start(): Promise<void> {
    if (this.isProcessing && !this.isPaused) {
      console.log('[RenderService] Already processing');
      return;
    }

    if (!this.videoSettings || !this.audioSettings) {
      throw new Error('Settings not configured. Apply a preset first.');
    }

    this.setProcessing(true);
    this.isPaused = false;
    this.notifyListeners();
    this.dispatch();
  }

  /**
   * Dispatch jobs to free slots deterministically (FIFO)
   */
  private dispatch(): void {
    if (this.isPaused || !this.isProcessing) return;

    const planned = this.scheduler.planNext((jobId) => {
      const job = this.jobs.get(jobId);
      return !!job && job.status === 'pending';
    });

    for (const target of planned) {
      this.scheduler.occupy(target.jobId, target.slot);
      void this.startJob(target.jobId, target.slot);
    }

    // If nothing planned and no active jobs, mark processing complete
    if (planned.length === 0 && this.activeJobs.size === 0) {
      const pendingExists = this.scheduler.getQueue().some(id => {
        const job = this.jobs.get(id);
        return job && job.status === 'pending';
      });
      if (!pendingExists) {
        this.setProcessing(false);
        this.currentJobId = null;
        this.notifyListeners();
      }
    }
  }

  /**
   * Start a specific job
   */
  private async startJob(jobId: string, slot: RenderSlot): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    // Update job status
    job.status = 'processing';
    job.startTime = Date.now();
    job.assignedSlot = slot; // Save which slot is used
    this.currentJobId = jobId;
    this.activeJobs.add(jobId);
    this.notifyListeners();

    const trim = this.normalizeTrimRange(job.durationSeconds, job.trimStartSec, job.trimEndSec);
    const shouldTrim =
      job.durationSeconds > 0 &&
      (trim.start > 0.0001 || trim.end < (job.durationSeconds - 0.0001)) &&
      (trim.end - trim.start) >= RenderServiceImpl.MIN_TRIM_DURATION_SEC;
    const effectiveDurationSeconds = shouldTrim
      ? (trim.end - trim.start)
      : Math.max(0, job.durationSeconds);

    // Add to statistics tracking
    try {
      StatisticsService.addRender({
        id: jobId,
        fileName: job.fileName,
        inputPath: job.inputPath,
        outputPath: job.outputPath,
        preset: this.selectedPresetName || 'Custom',
        video: {
          codec: this.videoSettings?.codec || 'unknown',
          bitrate: this.videoSettings?.bitrate || 'auto',
          crf: this.videoSettings?.crf || '23',
          fps: this.videoSettings?.fps || 'auto',
          resolution: this.videoSettings?.resolution || 'source',
          preset: this.videoSettings?.preset || 'medium',
        },
        audio: {
          codec: this.audioSettings?.codec || 'unknown',
          bitrate: String(this.audioSettings?.bitrate || '128'),
          sampleRate: String(this.audioSettings?.sampleRate || 44100),
          channels: String(this.audioSettings?.channels || 2),
        },
        duration: effectiveDurationSeconds,
      });
    } catch (statsError) {
      console.warn('[RenderService] Failed to add render to statistics:', statsError);
    }

    try {
      // Build FFmpeg arguments
      // AUTO FPS DETECTION: Detect FPS for each video if fpsAuto is enabled
      console.log(`[RenderService] Starting render for ${job.fileName} | fpsAuto: ${this.videoSettings?.fpsAuto}, fps: ${this.videoSettings?.fps}`);
      let effectiveVideoSettings = this.videoSettings!;
      if (this.videoSettings?.fpsAuto) {
        try {
          const detectedFps = await detectFpsForRender(job.inputPath, 30);
          console.log(`[RenderService] FPS Auto: Detected ${detectedFps} fps for ${job.fileName}`);
          
          // Create a new settings object with detected FPS
          effectiveVideoSettings = {
            ...this.videoSettings!,
            fps: detectedFps.toString(),
            fpsAuto: false, // Use the detected FPS, don't try to detect again
          };
          
          // Update statistics with detected FPS
          await invoke('write_render_log', {
            jobId,
            message: `[Auto FPS] Detected ${detectedFps} fps from video metadata`
          });
        } catch (fpsError) {
          console.warn('[RenderService] FPS detection failed, continuing with fallback FPS 30:', fpsError);
          effectiveVideoSettings = {
            ...this.videoSettings!,
            fps: '30',
            fpsAuto: false,
          };
          await invoke('write_render_log', {
            jobId,
            message: `[Auto FPS] Detection failed, using fallback FPS 30`
          }).catch(() => {});
        }
      }
      
      const preferGpu = slot === 'gpu' && this.gpuAvailable;
      const builder = new FFmpegCommandBuilder(
        effectiveVideoSettings,
        this.audioSettings!,
        this.watermarkSettings,
        preferGpu,
        job.outputPath
      );

      // Validate settings
      const validation = builder.validate();
      if (!validation.valid) {
        throw new Error(`Invalid settings: ${validation.errors.join('; ')}`);
      }

      // Log warnings but continue
      if (validation.warnings.length > 0) {
        console.warn('[RenderService] Parameter warnings:', validation.warnings);
        await invoke('write_render_log', {
          jobId,
          message: `Parameter warnings: ${validation.warnings.join('; ')}`
        });
      }

/**
 * Helper to split input arguments from output arguments matching backend Rust split_ffmpeg_args
 */
function splitFfmpegArgs(args: string[]): { inputArgs: string[]; outputArgs: string[] } {
  const inputArgs: string[] = [];
  const outputArgs: string[] = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (['-ss', '-t', '-to', '-hwaccel', '-hwaccel_device'].includes(arg) && i + 1 < args.length) {
      inputArgs.push(arg);
      inputArgs.push(args[i + 1]);
      i += 2;
    } else {
      outputArgs.push(arg);
      i += 1;
    }
  }
  return { inputArgs, outputArgs };
}

      const ffmpegArgs = builder.buildArgs();
      const ffmpegArgsWithTrim = shouldTrim
        ? ['-ss', trim.start.toFixed(3), '-t', effectiveDurationSeconds.toFixed(3), ...ffmpegArgs]
        : ffmpegArgs;
      
      const { inputArgs, outputArgs } = splitFfmpegArgs(ffmpegArgsWithTrim);
      const inputArgsStr = inputArgs.length > 0 ? `${inputArgs.join(' ')} ` : '';
      const inferredCommand = `ffmpeg -y ${inputArgsStr}-i "${job.inputPath}" ${outputArgs.join(' ')} "${job.outputPath}"`;

      // CRITICAL: Log FINAL command for comparison with preview
      console.log('[FINAL CMD] FFmpeg command:', inferredCommand);
      console.log('[FINAL CMD] Settings summary:', builder.getSettingsDescription());
      console.log('[FINAL CMD] Rate control params:', {
        codec: effectiveVideoSettings.codec,
        crf: effectiveVideoSettings.crf,
        bitrate: effectiveVideoSettings.bitrate,
        preset: effectiveVideoSettings.preset,
        preferGpu: preferGpu,
        hwaccel: effectiveVideoSettings.hwaccel,
      });

      // Log to file
      const runtimeDiagnostics = {
        timestamp: new Date().toISOString(),
        job: {
          id: jobId,
          fileName: job.fileName,
          inputPath: job.inputPath,
          outputPath: job.outputPath,
          assignedSlot: slot,
          renderMode: this.renderMode,
          gpuAvailable: this.gpuAvailable,
          selectedPresetName: this.selectedPresetName || 'Custom',
          sourceDurationSeconds: job.durationSeconds,
          effectiveDurationSeconds,
          trim: {
            enabled: shouldTrim,
            startSec: trim.start,
            endSec: trim.end,
          },
        },
        ffmpeg: {
          args: ffmpegArgsWithTrim,
          argsText: ffmpegArgsWithTrim.join(' '),
          inferredCommand,
        },
        settings: {
          videoEffective: effectiveVideoSettings,
          audio: this.audioSettings,
          watermark: this.watermarkSettings,
          mainScreen: this.mainScreenSettings,
        },
      };

      await invoke('write_render_log', {
        jobId,
        message: [
          `Starting render: ${job.inputPath} -> ${job.outputPath}`,
          `Settings: ${builder.getSettingsDescription()}`,
          `Trim: ${shouldTrim ? `${trim.start.toFixed(3)}s..${trim.end.toFixed(3)}s` : 'full'}`,
          `Args: ${ffmpegArgsWithTrim.join(' ')}`,
          'Diagnostics JSON:',
          JSON.stringify(runtimeDiagnostics, null, 2),
        ].join('\n')
      });

      // Start render
      const result = await invoke<RenderResult>('run_ffmpeg_render', {
        job: {
          job_id: jobId,
          input_path: job.inputPath,
          output_path: job.outputPath,
          ffmpeg_args: ffmpegArgsWithTrim,
          duration_seconds: effectiveDurationSeconds,
        }
      });

      if (result.success) {
        this.handleJobComplete(jobId);
      } else {
        // Parse and format FFmpeg error for user
        const formattedError = this.formatFFmpegError(result.error || 'Unknown error');
        this.handleJobError(jobId, formattedError);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const formattedError = this.formatFFmpegError(errorMessage);
      this.handleJobError(jobId, formattedError);
    }
  }

  /**
   * Handle progress update from FFmpeg (throttled)
   */
  private handleProgressUpdate(progress: RenderProgress): void {
    const job = this.jobs.get(progress.job_id);
    if (!job) return;

    job.progress = Math.min(100, progress.progress_percent);
    job.eta = progress.eta_seconds;
    job.etaFormatted = this.formatETA(progress.eta_seconds);
    job.currentTime = progress.time_seconds;
    job.fps = progress.fps;
    job.speed = progress.speed;
    job.bitrate = progress.bitrate;
    job.frame = progress.frame;
    
    // Parse output file size from FFmpeg (e.g., "1024kB", "512KiB", "1.5MB")
    if (progress.total_size) {
      const parsed = this.parseFileSize(progress.total_size);
      job.outputSizeBytes = parsed.bytes;
      job.outputSize = parsed.formatted;
      
      // Calculate estimated final size based on progress ratio
      // Only estimate if we have at least 5% progress to avoid wild estimates
      if (progress.progress_percent >= 5 && parsed.bytes > 0) {
        const processedRatio = progress.progress_percent / 100;
        const estimatedBytes = Math.round(parsed.bytes / processedRatio);
        const estimatedMB = estimatedBytes / (1024 * 1024);
        
        job.estimatedFinalSizeBytes = estimatedBytes;
        job.estimatedFinalSize = estimatedMB >= 1000
          ? `~${(estimatedMB / 1024).toFixed(2)} GB`
          : `~${estimatedMB.toFixed(1)} MB`;
      }
    }

    const progressData: JobProgressData = {
      jobId: job.id,
      progress: job.progress,
      fps: job.fps,
      speed: job.speed,
      bitrate: job.bitrate,
      eta: job.eta,
      etaFormatted: job.etaFormatted || '--:--',
      currentTime: job.currentTime,
      frame: job.frame,
      outputSize: job.outputSize || '0 MB',
      estimatedFinalSize: job.estimatedFinalSize,
    };

    this.pendingJobProgress.set(job.id, progressData);

    // Throttled notification (every 80ms)
    if (!this.progressThrottleTimer) {
      this.progressThrottleTimer = setTimeout(() => {
        this.progressThrottleTimer = null;
        this.flushProgressUpdates();
      }, 80);
    }
  }

  /**
   * Flush pending progress updates to dedicated and global listeners
   */
  private flushProgressUpdates(): void {
    this.pendingJobProgress.forEach((data, jobId) => {
      const listeners = this.jobProgressListeners.get(jobId);
      if (listeners) {
        listeners.forEach((callback) => {
          try {
            callback(data);
          } catch (e) {
            console.error('[RenderService] Error in job progress listener:', e);
          }
        });
      }
    });
    this.pendingJobProgress.clear();
    this.notifyListeners();
  }

  /**
   * Parse FFmpeg size string to bytes and formatted MB string
   */
  private parseFileSize(sizeStr: string): { bytes: number; formatted: string } {
    const str = sizeStr.trim().toLowerCase();
    let bytes = 0;
    
    // Match patterns like "1024kB", "512KiB", "1.5MB", "256mib"
    const match = str.match(/^([\d.]+)\s*(kib|kb|mib|mb|gib|gb|b)?$/i);
    if (match) {
      const value = parseFloat(match[1]);
      const unit = (match[2] || 'b').toLowerCase();
      
      switch (unit) {
        case 'b':
          bytes = value;
          break;
        case 'kb':
        case 'kib':
          bytes = value * 1024;
          break;
        case 'mb':
        case 'mib':
          bytes = value * 1024 * 1024;
          break;
        case 'gb':
        case 'gib':
          bytes = value * 1024 * 1024 * 1024;
          break;
      }
    }
    
    // Format to MB with 1 decimal
    const mb = bytes / (1024 * 1024);
    const formatted = mb >= 1000 
      ? `${(mb / 1024).toFixed(2)} GB` 
      : `${mb.toFixed(1)} MB`;
    
    return { bytes, formatted };
  }

  /**
   * Handle job completion
   */
  private handleJobComplete(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const slot = job.assignedSlot || 'unknown';
    job.status = 'completed';
    job.progress = 100;
    job.eta = 0;
    job.etaFormatted = '00:00:00';
    job.endTime = Date.now();
    this.activeJobs.delete(jobId);
    this.scheduler.release(jobId);

    if (this.activeJobs.size === 0) {
      this.currentJobId = null;
    }

    console.log(`[RenderService] Job completed on ${slot.toUpperCase()} slot:`, jobId);

    // Log completion with slot info
    invoke('write_render_log', {
      jobId,
      message: `Render completed on ${slot.toUpperCase()} slot. Duration: ${((job.endTime! - job.startTime!) / 1000).toFixed(1)}s`
    });
    this.notifyListeners();
    

    // Process next job(s) - Duo mode can continue parallel rendering
    if (this.isProcessing && !this.isPaused) {
      console.log(`[RenderService] Dispatching next job after ${slot.toUpperCase()} completion. Active jobs: ${this.activeJobs.size}`);
      this.dispatch();
    }
    }
    
    /**
     * Handle job stopped by user
     */
    private handleJobStopped(jobId: string, stoppedBy: string): void {
      const job = this.jobs.get(jobId);
      if (!job) return;

      // Only update if still processing
      if (job.status === 'processing') {
        job.status = 'stopped';
        job.endTime = Date.now();
        this.activeJobs.delete(jobId);
        this.scheduler.release(jobId);
        this.currentJobId = null;
        this.setProcessing(false); // stop queue advancement

        console.log('[RenderService] Job stopped:', jobId, `by ${stoppedBy}`);

        // Log stop
        invoke('write_render_log', {
          jobId,
          message: `Render stopped by ${stoppedBy}. Duration: ${((job.endTime! - job.startTime!) / 1000).toFixed(1)}s`
        });

        // Update statistics - mark as stopped, NOT as error
        StatisticsService.markRenderStopped(jobId);

        this.notifyListeners();

        // DO NOT continue queue - wait for manual start
        console.log('[RenderService] Queue paused after stop');
      }
    }
  

  /**
   * Handle job error
   */
    private handleJobError(jobId: string, error: string): void {
        const job = this.jobs.get(jobId);
        if (!job) return;

        const slot = job.assignedSlot || 'unknown';
        job.status = 'error';
        job.error = error;
        job.endTime = Date.now();
        this.activeJobs.delete(jobId);
        this.scheduler.release(jobId);

        if (this.activeJobs.size === 0) {
          this.currentJobId = null;
        }

        console.error(`[RenderService] Job failed on ${slot.toUpperCase()} slot:`, jobId, error);

        // Update statistics
        StatisticsService.markRenderError(jobId, error);

        // Log error with slot info
        invoke('write_render_log', {
          jobId,
          message: `Render failed on ${slot.toUpperCase()} slot: ${error}`
        });
    
    this.notifyListeners();
    
    // Continue with next job - other slot's renders are unaffected
    if (this.isProcessing && !this.isPaused) {
      console.log(`[RenderService] Dispatching next job after ${slot.toUpperCase()} error. Active jobs: ${this.activeJobs.size}`);
      this.dispatch();
    }
    }

  /**
   * Format FFmpeg error messages for user display
   */
  private formatFFmpegError(rawError: string): string {
    // Common FFmpeg error patterns and their user-friendly messages
    const errorPatterns: Array<{ pattern: RegExp; message: string }> = [
      {
        pattern: /Error applying option .* to filter '([^']+)': (.*)/i,
        message: 'Audio/video filter error: $1 - $2. Check filter parameters.',
      },
      {
        pattern: /afftdn.*Result too large/i,
        message: 'Noise reduction level is too high. The value has been auto-corrected for next attempt.',
      },
      {
        pattern: /Invalid (encoder|codec|format)/i,
        message: 'Invalid encoder or format. Please check codec settings.',
      },
      {
        pattern: /No such file or directory/i,
        message: 'Input file not found. Please verify the file path.',
      },
      {
        pattern: /Permission denied/i,
        message: 'Permission denied. Cannot write to output location.',
      },
      {
        pattern: /Encoder .* not found/i,
        message: 'Required encoder not available. Try a different codec.',
      },
      {
        pattern: /Error opening output file/i,
        message: 'Cannot create output file. Check output path and permissions.',
      },
      {
        pattern: /Invalid option/i,
        message: 'Invalid FFmpeg option. Settings may be incompatible.',
      },
      {
        pattern: /crf .* too (high|low)/i,
        message: 'CRF value out of range. Valid range is 0-51.',
      },
      {
        pattern: /Discarding non-monotonous/i,
        message: 'Timestamp issue detected. Output may have minor glitches.',
      },
      {
        pattern: /Could not find tag for codec/i,
        message: 'Codec not supported in this container format.',
      },
      {
        pattern: /Out of memory/i,
        message: 'Not enough memory. Try reducing resolution or closing other apps.',
      },
    ];

    // Try to match patterns and return friendly message
    for (const { pattern, message } of errorPatterns) {
      const match = rawError.match(pattern);
      if (match) {
        // Replace placeholders with captured groups
        let formattedMessage = message;
        for (let i = 1; i < match.length; i++) {
          formattedMessage = formattedMessage.replace(`$${i}`, match[i] || '');
        }
        return formattedMessage;
      }
    }

    // If no pattern matched, try to extract just the key error
    const errorLines = rawError.split('\n').filter(line => 
      line.includes('Error') || line.includes('error') || line.includes('Invalid')
    );
    
    if (errorLines.length > 0) {
      // Return first meaningful error line, truncated if too long
      const firstError = errorLines[0].trim();
      return firstError.length > 150 ? firstError.substring(0, 150) + '...' : firstError;
    }

    // Fallback: return truncated raw error
    return rawError.length > 200 ? rawError.substring(0, 200) + '...' : rawError;
  }

  /**
   * Pause processing
   */
  public pause(): void {
    this.isPaused = true;
    
    // Mark current job as paused
    if (this.currentJobId) {
      const job = this.jobs.get(this.currentJobId);
      if (job && job.status === 'processing') {
        job.status = 'paused';
      }
    }

    this.notifyListeners();
    console.log('[RenderService] Paused');
  }

  /**
   * Resume processing
   */
  public async resume(): Promise<void> {
    if (!this.isPaused) return;

    this.isPaused = false;

    // Resume current job or start next
    if (this.currentJobId) {
      const job = this.jobs.get(this.currentJobId);
      if (job && job.status === 'paused') {
        job.status = 'processing';
      }
    }

    this.notifyListeners();
    console.log('[RenderService] Resumed');

    // Continue processing
    this.dispatch();
  }

  /**
   * Stop all processing
   */
  public async stop(): Promise<void> {
    this.setProcessing(false);
    this.isPaused = false;
    this.scheduler.resetSlots();

    // Stop all active jobs
    try {
      await invoke('stop_all_renders');
    } catch (error) {
      console.error('[RenderService] Error stopping renders:', error);
    }

    // Mark active jobs as stopped
    this.activeJobs.forEach(jobId => {
      const job = this.jobs.get(jobId);
      if (job) {
        job.status = 'stopped';
      }
    });
    this.activeJobs.clear();
    this.currentJobId = null;

    this.notifyListeners();
    console.log('[RenderService] Stopped');
  }

  /**
   * Stop specific job (current render)
   */
  public async stopJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'processing') {
      try {
        await invoke('stop_ffmpeg_render', { jobId });

        // Local state updates; render-stopped event will also adjust
        job.status = 'stopped';
        this.activeJobs.delete(jobId);
        this.scheduler.release(jobId);
        this.currentJobId = null;
        if (this.activeJobs.size === 0) {
          this.setProcessing(false);
        }

        this.notifyListeners();
        return true;
      } catch (error) {
        console.error('[RenderService] Error stopping job:', error);
        return false;
      }
    }

    return false;
  }




  /**
   * Format ETA in HH:MM:SS
   */
  private formatETA(seconds: number): string {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) {
      return '--:--:--';
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  private normalizeTrimRange(durationSeconds: number, startSec: number, endSec: number): { start: number; end: number } {
    if (!isFinite(durationSeconds) || durationSeconds <= 0) {
      return { start: 0, end: 0 };
    }

    const safeStart = Number.isFinite(startSec) ? startSec : 0;
    const safeEnd = Number.isFinite(endSec) ? endSec : durationSeconds;
    const clampedStart = Math.max(0, Math.min(durationSeconds, safeStart));
    const clampedEnd = Math.max(0, Math.min(durationSeconds, safeEnd));

    if (clampedEnd < clampedStart) {
      return { start: clampedEnd, end: clampedStart };
    }

    return { start: clampedStart, end: clampedEnd };
  }

  /**
   * Get current queue state
   */
  public getState(): RenderQueueState {
    return {
      jobs: this.getJobs(),
      isProcessing: this.isProcessing,
      isPaused: this.isPaused,
      currentJobId: this.currentJobId,
      renderMode: this.renderMode,
      gpuAvailable: this.gpuAvailable,
    };
  }

  /**
   * Get current render mode
   */
  public getRenderMode(): RenderMode {
    return this.renderMode;
  }

  /**
   * Get GPU availability
   */
  public getGpuAvailable(): boolean {
    return this.gpuAvailable;
  }

  /**
   * Get all jobs (from the jobs Map, not just the queue)
   * Returns all jobs in a consistent order: processing first, then pending (queue order), then completed/error
   */
  public getJobs(): RenderJob[] {
    const allJobs = Array.from(this.jobs.values());
    
    // Sort: processing jobs first, then pending in queue order, then completed/error
    const processing: RenderJob[] = [];
    const pending: RenderJob[] = [];
    const finished: RenderJob[] = [];
    
    for (const job of allJobs) {
      if (job.status === 'processing' || job.status === 'paused') {
        processing.push(job);
      } else if (job.status === 'pending') {
        pending.push(job);
      } else {
        finished.push(job);
      }
    }
    
    // Sort pending by queue order
    const queueOrder = this.scheduler.getQueue();
    pending.sort((a, b) => {
      const aIdx = queueOrder.indexOf(a.id);
      const bIdx = queueOrder.indexOf(b.id);
      return aIdx - bIdx;
    });
    
    return [...processing, ...pending, ...finished];
  }
}

// Export singleton instance
export const RenderService = new RenderServiceImpl();
export default RenderService;
