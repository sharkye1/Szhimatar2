/**
 * Unified Test Harness for E2E Suite
 * Contains factories, reference command builders, and capability detection.
 */

import {
  VideoSettingsContract,
  AudioSettingsContract,
  PreviewSettingsContract,
  calculateVideoToolboxQuality,
  VIDEOTOOLBOX_ENCODERS,
  NVENC_ENCODERS,
  CPU_ENCODERS,
  PlatformOS,
} from './contracts';
import { FFmpegCommandBuilder } from '../../../src/services/RenderService';
import type { VideoSettings, AudioSettings } from '../../../src/types';

export class TestHarness {
  /**
   * Factory for default VideoSettings
   */
  static createDefaultVideoSettings(overrides?: Partial<VideoSettingsContract>): VideoSettings {
    const defaults: VideoSettings = {
      codec: 'h264',
      crf: 23,
      preset: 'medium',
      rateControlMode: 'crf',
      fps: '30',
      fpsAuto: true,
      bitrate: 5,
      maxrate: 8,
      bFrames: 3,
      targetFormat: 'video',
      hwaccel: 'auto',
      customResolution: false,
      keepAudio: true,
      gopSize: 'auto',
      nvencMultipass: 'disabled',
    };
    return { ...defaults, ...overrides } as VideoSettings;
  }

  /**
   * Factory for default AudioSettings
   */
  static createDefaultAudioSettings(overrides?: Partial<AudioSettingsContract>): AudioSettings {
    const defaults: AudioSettings = {
      codec: 'aac',
      bitrate: '192k',
      sampleRate: '48000',
      channels: '2',
      volume: 1.0,
      normalizeAudio: false,
    };
    return { ...defaults, ...overrides } as AudioSettings;
  }

  /**
   * Factory for default PreviewSettings
   */
  static createDefaultPreviewSettings(overrides?: Partial<PreviewSettingsContract>): PreviewSettingsContract {
    const defaults: PreviewSettingsContract = {
      video_path: '/dummy/input.mp4',
      time_seconds: 10.0,
      duration: 3.0,
      codec: 'h264',
      crf: '23',
      bitrate: '5',
      rate_control_mode: 'crf',
      prefer_gpu: true,
      resampling_enabled: false,
      fps: '30',
    };
    return { ...defaults, ...overrides };
  }

  /**
   * Reference VideoToolbox Command Builder (Authoritative Model)
   * Encapsulates the exact specification contracts in PROJECT.md:
   * - h264 -> h264_videotoolbox
   * - hevc/h265 -> hevc_videotoolbox
   * - CRF -> -q:v clamp(round((51 - crf)*100/51), 1, 100)
   * - VBR -> -b:v <bitrate>M
   * - Omission of all NVENC flags
   */
  static buildReferenceVideoToolboxArgs(
    videoSettings: VideoSettingsContract,
    audioSettings?: AudioSettingsContract
  ): string[] {
    const args: string[] = [];

    // Hardware decoding on input if specified
    if (videoSettings.hwaccel && videoSettings.hwaccel !== 'disabled') {
      args.push('-hwaccel', videoSettings.hwaccel);
    }

    // Encoder selection
    const codec = videoSettings.codec.toLowerCase();
    const encoder = codec === 'h265' || codec === 'hevc'
      ? VIDEOTOOLBOX_ENCODERS.hevc
      : VIDEOTOOLBOX_ENCODERS.h264;
    args.push('-c:v', encoder);

    // Rate control
    const mode = videoSettings.rateControlMode || 'crf';
    if (mode === 'crf') {
      const q = calculateVideoToolboxQuality(videoSettings.crf);
      args.push('-q:v', q.toString());
    } else if (mode === 'vbr' || mode === 'cbr') {
      const br = videoSettings.bitrate || 5;
      args.push('-b:v', `${br}M`);
      if (videoSettings.maxrate) {
        args.push('-maxrate', `${videoSettings.maxrate}M`);
      }
    } else if (mode === 'constrained_crf') {
      const q = calculateVideoToolboxQuality(videoSettings.crf);
      args.push('-q:v', q.toString());
      if (videoSettings.bitrate) {
        args.push('-b:v', `${videoSettings.bitrate}M`);
      }
      if (videoSettings.maxrate) {
        args.push('-maxrate', `${videoSettings.maxrate}M`);
      }
    }

    // FPS
    if (!videoSettings.fpsAuto && videoSettings.fps) {
      args.push('-r', videoSettings.fps);
    }

    // Audio settings
    if (audioSettings) {
      args.push('-c:a', audioSettings.codec);
      if (audioSettings.bitrate) {
        args.push('-b:a', audioSettings.bitrate);
      }
      if (audioSettings.sampleRate) {
        args.push('-ar', audioSettings.sampleRate);
      }
      if (audioSettings.channels) {
        args.push('-ac', audioSettings.channels);
      }
    }

    return args;
  }

  /**
   * Check if live RenderService currently outputs VideoToolbox when preferGpu = true on macOS
   */
  static checkLiveRenderServiceHasVideoToolbox(): boolean {
    try {
      const videoSettings = this.createDefaultVideoSettings({ codec: 'h264' });
      const audioSettings = this.createDefaultAudioSettings();
      const builder = new FFmpegCommandBuilder(videoSettings, audioSettings, undefined, true);
      const args = builder.buildArgs();
      return args.includes('h264_videotoolbox');
    } catch {
      return false;
    }
  }

  /**
   * Reference Preview Video Command Builder (for get_preview_video)
   */
  static buildReferencePreviewArgs(settings: PreviewSettingsContract, isMac: boolean): string[] {
    const cmdArgs: string[] = [
      '-ss',
      `${settings.time_seconds.toFixed(3)}`,
      '-i',
      settings.video_path,
      '-t',
      `${Math.max(0.1, Math.min(5.0, settings.duration !== undefined ? settings.duration : 3.0)).toFixed(1)}`,
    ];

    const useGpu = settings.prefer_gpu ?? false;
    const isHevc = settings.codec === 'h265' || settings.codec === 'hevc';

    const parsedCrf = parseInt(settings.crf, 10);
    const crf = !isNaN(parsedCrf) ? parsedCrf : 23;

    if (isMac && useGpu) {
      cmdArgs.push('-c:v', isHevc ? 'hevc_videotoolbox' : 'h264_videotoolbox');
      const q = calculateVideoToolboxQuality(crf);
      cmdArgs.push('-q:v', q.toString());
    } else if (!isMac && useGpu) {
      cmdArgs.push('-c:v', isHevc ? 'hevc_nvenc' : 'h264_nvenc');
      cmdArgs.push('-rc', 'constqp', '-cq', crf.toString(), '-qp', crf.toString());
    } else {
      cmdArgs.push('-c:v', isHevc ? 'libx265' : 'libx264');
      cmdArgs.push('-crf', settings.crf);
    }

    return cmdArgs;
  }
}
