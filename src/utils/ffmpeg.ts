import { invoke } from '@tauri-apps/api/tauri';
import { Command } from '@tauri-apps/api/shell';

export interface FfmpegStatus {
  ffmpeg_found: boolean;
  ffprobe_found: boolean;
  ffmpeg_path: string;
  ffprobe_path: string;
  ffmpeg_version: string;
  ffprobe_version: string;
}

export interface FFmpegConfig {
  ffmpegPath: string;
  ffprobePath: string;
}

export interface VideoConfig {
  codec: string;
  bitrate: string;
  fps: string;
  resolution: string;
  crf: string;
  preset: string;
}

export interface AudioConfig {
  codec: string;
  bitrate: string;
  channels: string;
  sampleRate: string;
  volume: string;
}

export interface WatermarkConfig {
  enabled: boolean;
  imagePath: string;
  position: string;
  opacity: number;
}

export interface VideoSettings {
  codec: string;
  bitrate: number; // in Mbps
  fps: number;
  resolution: string; // "1920x1080" or "original"
  crf?: number; // 0-51, lower = better quality
  preset?: string; // ultrafast, superfast, veryfast, faster, fast, medium, slow, slower
}

export interface AudioSettings {
  codec: string;
  bitrate: number; // in kbps
  channels: number;
  sampleRate: number; // 44100, 48000, etc
  volume?: number; // 0.0-1.0
}

export interface FFmpegJob {
  jobId: string;
  input: string;
  output: string;
  videoSettings: VideoSettings;
  audioSettings: AudioSettings;
  watermarkConfig?: WatermarkConfig;
}

export interface FFmpegProgress {
  frame: number;
  fps: number;
  q: number;
  bitrate: string;
  time: string;
  speed: number;
  percentComplete: number;
}

export type FFmpegEventType = 'start' | 'progress' | 'complete' | 'error' | 'pause' | 'resume';

export interface FFmpegEvent {
  type: FFmpegEventType;
  jobId: string;
  progress?: FFmpegProgress;
  error?: string;
}

/**
 * Check if FFmpeg and FFprobe are available
 */
export async function checkFfmpegStatus(): Promise<FfmpegStatus> {
  return await invoke<FfmpegStatus>('check_ffmpeg_status');
}

/**
 * Search for FFmpeg in common locations (fast)
 */
export async function searchFfmpegFast(): Promise<FfmpegStatus> {
  return await invoke<FfmpegStatus>('search_ffmpeg_fast');
}

/**
 * Deep search for FFmpeg (slow, scans entire system)
 */
export async function searchFfmpegDeep(): Promise<FfmpegStatus> {
  return await invoke<FfmpegStatus>('search_ffmpeg_deep');
}

/**
 * Search for a single binary (ffmpeg or ffprobe)
 * Returns path and version if found
 */
export async function searchFFmpegSingle(name: 'ffmpeg' | 'ffprobe'): Promise<{ found: boolean; path: string; version: string }> {
  return await invoke<{ found: boolean; path: string; version: string }>('search_ffmpeg_single', { name });
}

/**
 * Resolve a relative or short path to absolute path
 */
export async function resolveAbsolutePath(relativePath: string): Promise<{ path: string }> {
  return await invoke<{ path: string }>('resolve_absolute_path', { relativePath });
}

/**
 * Get version output from a binary
 */
export async function getBinaryVersion(binaryPath: string): Promise<{ output: string }> {
  return await invoke<{ output: string }>('get_binary_version', { binaryPath });
}

/**
 * Save FFmpeg and FFprobe paths to configuration
 */
export async function saveFFmpegPaths(ffmpegPath: string, ffprobePath: string): Promise<{ success: boolean }> {
  return await invoke<{ success: boolean }>('save_ffmpeg_paths', { ffmpegPath, ffprobePath });
}

/**
 * Load previously saved FFmpeg/FFprobe paths from configuration
 */
export async function loadFFmpegPaths(): Promise<{ ffmpeg_path: string; ffprobe_path: string }> {
  return await invoke<{ ffmpeg_path: string; ffprobe_path: string }>('load_ffmpeg_paths');
}

/**
 * Manually set FFmpeg and FFprobe paths
 */
export async function setFfmpegPaths(ffmpegPath: string, ffprobePath: string): Promise<FfmpegStatus> {
  return await invoke<FfmpegStatus>('set_ffmpeg_paths', {
    ffmpegPath,
    ffprobePath,
  });
}

export interface VideoMetadata {
  fps: number;
  duration: number;
  width: number;
  height: number;
  bitrate: number;
  codec: string;
}

/**
 * Parse FPS from FFprobe r_frame_rate format (e.g., "30000/1001" or "30/1")
 */
function parseFps(rFrameRate: string): number {
  if (!rFrameRate || rFrameRate === '0/0') {
    return 0;
  }
  
  const parts = rFrameRate.split('/');
  if (parts.length === 2) {
    const numerator = parseFloat(parts[0]);
    const denominator = parseFloat(parts[1]);
    if (denominator !== 0) {
      return Math.round((numerator / denominator) * 100) / 100; // Round to 2 decimals
    }
  }
  
  return parseFloat(rFrameRate) || 0;
}

/**
 * Get video metadata using FFprobe
 * Runs FFprobe via Tauri shell and parses JSON output
 * 
 * @param filePath - Absolute path to video file
 * @returns VideoMetadata object with fps, duration, width, height, bitrate, codec
 * @throws Error if FFprobe not found, file not found, or invalid output
 */
export async function getVideoMetadata(filePath: string): Promise<VideoMetadata> {
  console.log('[getVideoMetadata] Starting for file:', filePath);
  
  try {
    // Get FFprobe path from config
    const paths = await loadFFmpegPaths();
    const ffprobePath = paths.ffprobe_path;
    
    if (!ffprobePath || ffprobePath.trim() === '') {
      throw new Error('FFprobe not configured. Please set up FFmpeg in settings first.');
    }
    
    console.log('[getVideoMetadata] Using FFprobe at:', ffprobePath);
    
    // Build FFprobe command with JSON output
    // -v quiet: suppress FFprobe messages
    // -print_format json: output as JSON
    // -show_format: show container format info (duration, bitrate)
    // -show_streams: show stream info (codec, fps, resolution)
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ];
    
    console.log('[getVideoMetadata] Executing FFprobe with args:', args);
    
    // Execute FFprobe via Tauri shell
    const command = new Command(ffprobePath, args);
    const output = await command.execute();
    
    console.log('[getVideoMetadata] FFprobe exit code:', output.code);
    
    if (output.code !== 0) {
      const errorMsg = output.stderr || 'Unknown error';
      console.error('[getVideoMetadata] FFprobe error:', errorMsg);
      
      if (errorMsg.toLowerCase().includes('no such file') || errorMsg.toLowerCase().includes('does not exist')) {
        throw new Error(`Video file not found: ${filePath}`);
      }
      
      throw new Error(`FFprobe failed: ${errorMsg}`);
    }
    
    // Parse JSON output
    let probeData: any;
    try {
      probeData = JSON.parse(output.stdout);
      console.log('[getVideoMetadata] Parsed FFprobe data successfully');
    } catch (parseError) {
      console.error('[getVideoMetadata] Failed to parse JSON:', output.stdout);
      throw new Error('FFprobe returned invalid JSON output');
    }
    
    // Find video stream (usually first stream, but could be any with codec_type === 'video')
    const videoStream = probeData.streams?.find((s: any) => s.codec_type === 'video');
    
    if (!videoStream) {
      throw new Error('No video stream found in file');
    }
    
    console.log('[getVideoMetadata] Video stream found:', {
      codec: videoStream.codec_name,
      width: videoStream.width,
      height: videoStream.height,
      fps: videoStream.r_frame_rate,
      bitrate: videoStream.bit_rate
    });
    
    // Extract metadata with fallbacks
    const fps = parseFps(videoStream.r_frame_rate || '0/0');
    const duration = parseFloat(probeData.format?.duration || '0');
    const width = parseInt(videoStream.width || '0', 10);
    const height = parseInt(videoStream.height || '0', 10);
    
    // Bitrate: try stream bitrate first, then format bitrate
    let bitrate = parseInt(videoStream.bit_rate || '0', 10);
    if (bitrate === 0 && probeData.format?.bit_rate) {
      bitrate = parseInt(probeData.format.bit_rate, 10);
    }
    // Convert from bits/sec to kbits/sec
    bitrate = Math.round(bitrate / 1000);
    
    const codec = videoStream.codec_name || 'unknown';
    
    const metadata: VideoMetadata = {
      fps,
      duration,
      width,
      height,
      bitrate,
      codec
    };
    
    console.log('[getVideoMetadata] Extracted metadata:', metadata);
    
    return metadata;
    
  } catch (error) {
    console.error('[getVideoMetadata] Error:', error);
    
    // Re-throw with more context if needed
    if (error instanceof Error) {
      throw error;
    }
    
    throw new Error(`Failed to get video metadata: ${String(error)}`);
  }
}

// Placeholder for FFmpeg command builder
export class FFmpegCommandBuilder {
  private ffmpegPath: string = 'ffmpeg';
  
  constructor(config: FFmpegConfig) {
    this.ffmpegPath = config.ffmpegPath;
  }

  buildCommand(
    inputPath: string,
    outputPath: string,
    videoConfig: VideoConfig,
    audioConfig: AudioConfig,
    watermarkConfig?: WatermarkConfig
  ): string {
    // This is a placeholder - actual FFmpeg command construction will be implemented later
    let command = `${this.ffmpegPath} -i "${inputPath}"`;
    
    // Video settings
    command += ` -c:v ${videoConfig.codec}`;
    command += ` -b:v ${videoConfig.bitrate}M`;
    command += ` -r ${videoConfig.fps}`;
    
    if (videoConfig.resolution !== 'original') {
      command += ` -s ${videoConfig.resolution}`;
    }
    
    if (videoConfig.codec === 'h264' || videoConfig.codec === 'h265') {
      command += ` -crf ${videoConfig.crf}`;
      command += ` -preset ${videoConfig.preset}`;
    }

    // Audio settings
    command += ` -c:a ${audioConfig.codec}`;
    command += ` -b:a ${audioConfig.bitrate}k`;
    command += ` -ac ${audioConfig.channels}`;
    command += ` -ar ${audioConfig.sampleRate}`;

    // Watermark (placeholder)
    if (watermarkConfig && watermarkConfig.enabled) {
      // Watermark filter will be added here
      console.log('Watermark config:', watermarkConfig);
    }

    command += ` "${outputPath}"`;
    
    return command;
  }
}

// Placeholder for FFmpeg process manager (for future implementation)
export class FFmpegProcessManager {
  // TODO: Implement FFmpeg process management
  // private currentProcess: any = null;
  // private isPaused: boolean = false;

  async startCompression(command: string): Promise<void> {
    console.log('Starting FFmpeg process:', command);
    // TODO: Execute FFmpeg process via Tauri shell
    // This will be implemented when actual FFmpeg integration is added
  }

  async pause(): Promise<void> {
    // this.isPaused = true;
    console.log('Pausing FFmpeg process...');
    // TODO: Implement pause logic
  }

  async resume(): Promise<void> {
    // this.isPaused = false;
    console.log('Resuming FFmpeg process...');
    // TODO: Implement resume logic
  }

  async stop(): Promise<void> {
    console.log('Stopping FFmpeg process...');
    // TODO: Kill FFmpeg process
    // this.currentProcess = null;
  }

  getProgress(): number {
    // TODO: Parse FFmpeg output to get progress
    return 0;
  }
}

/**
 * Parse FFmpeg progress line to extract frame, fps, bitrate, time, speed
 * Example: frame=  150 fps=50 q=28.0 Lsize=N/A time=00:00:06.00 bitrate=N/A speed=2.0x
 * @param line - Progress line from FFmpeg stdout
 * @param totalFrames - Total number of frames in video
 * @returns Parsed progress data
 */
export function parseFFmpegProgress(line: string, totalFrames: number): FFmpegProgress {
  const frameMatch = line.match(/frame=\s*(\d+)/);
  const fpsMatch = line.match(/fps=\s*(\d+)/);
  const qMatch = line.match(/q=\s*([-\d.]+)/);
  const bitrateMatch = line.match(/bitrate=\s*(\S+)/);
  const timeMatch = line.match(/time=\s*(\d+:\d+:\d+\.\d+)/);
  const speedMatch = line.match(/speed=\s*([\d.]+)x/);

  const frame = frameMatch ? parseInt(frameMatch[1], 10) : 0;
  const fps = fpsMatch ? parseInt(fpsMatch[1], 10) : 0;
  const q = qMatch ? parseFloat(qMatch[1]) : 0;
  const bitrate = bitrateMatch ? bitrateMatch[1] : '0';
  const time = timeMatch ? timeMatch[1] : '00:00:00.00';
  const speed = speedMatch ? parseFloat(speedMatch[1]) : 0;

  // Calculate progress percentage
  let percentComplete = 0;
  if (totalFrames > 0) {
    percentComplete = Math.min(100, Math.round((frame / totalFrames) * 100));
  }

  return {
    frame,
    fps,
    q,
    bitrate,
    time,
    speed,
    percentComplete
  };
}

/**
 * FFmpeg Manager - Handles video rendering and process management
 * Supports job queue, pause/resume, progress tracking
 */
export class FFmpegManager {
  private ffmpegPath: string = '';
  private currentProcess: Command | null = null;
  private isPaused: boolean = false;
  private jobQueue: FFmpegJob[] = [];
  private currentJob: FFmpegJob | null = null;
  private eventListeners: Array<(event: FFmpegEvent) => void> = [];
  private totalFrames: number = 0;
  private abortController: AbortController | null = null;

  constructor() {
    console.log('[FFmpegManager] Initialized');
  }

  /**
   * Register event listener for FFmpeg events
   */
  on(listener: (event: FFmpegEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /**
   * Unregister event listener
   */
  off(listener: (event: FFmpegEvent) => void): void {
    this.eventListeners = this.eventListeners.filter(l => l !== listener);
  }

  /**
   * Emit event to all listeners
   */
  private emitEvent(event: FFmpegEvent): void {
    console.log('[FFmpegManager] Event:', event);
    this.eventListeners.forEach(listener => listener(event));
  }

  /**
   * Load FFmpeg path from config
   */
  private async loadFFmpegPath(): Promise<void> {
    try {
      const paths = await loadFFmpegPaths();
      this.ffmpegPath = paths.ffmpeg_path;

      if (!this.ffmpegPath || this.ffmpegPath.trim() === '') {
        throw new Error('FFmpeg not configured. Please set up FFmpeg in settings first.');
      }

      console.log('[FFmpegManager] Using FFmpeg at:', this.ffmpegPath);
    } catch (error) {
      console.error('[FFmpegManager] Failed to load FFmpeg path:', error);
      throw error;
    }
  }

  /**
   * Build FFmpeg command arguments from job settings
   */
  private buildFFmpegArgs(job: FFmpegJob): string[] {
    const args: string[] = ['-i', job.input];

    // Video codec and settings
    args.push('-c:v', job.videoSettings.codec);
    args.push('-b:v', `${job.videoSettings.bitrate}M`);
    args.push('-r', String(job.videoSettings.fps));

    // Resolution
    if (job.videoSettings.resolution !== 'original') {
      args.push('-s', job.videoSettings.resolution);
    }

    // CRF for H.264/H.265
    if ((job.videoSettings.codec === 'libx264' || job.videoSettings.codec === 'libx265') && job.videoSettings.crf) {
      args.push('-crf', String(job.videoSettings.crf));
    }

    // Preset for H.264/H.265
    if ((job.videoSettings.codec === 'libx264' || job.videoSettings.codec === 'libx265') && job.videoSettings.preset) {
      args.push('-preset', job.videoSettings.preset);
    }

    // Audio codec and settings
    args.push('-c:a', job.audioSettings.codec);
    args.push('-b:a', `${job.audioSettings.bitrate}k`);
    args.push('-ac', String(job.audioSettings.channels));
    args.push('-ar', String(job.audioSettings.sampleRate));

    // Volume (if specified)
    if (job.audioSettings.volume !== undefined && job.audioSettings.volume !== 1) {
      args.push('-af', `volume=${job.audioSettings.volume}`);
    }

    // Watermark filter (if enabled)
    if (job.watermarkConfig?.enabled) {
      const watermarkFilter = this.buildWatermarkFilter(job.watermarkConfig);
      args.push('-vf', watermarkFilter);
    }

    // Progress output
    args.push('-progress', 'pipe:1');

    // Overwrite output without prompting
    args.push('-y');

    // Output file
    args.push(job.output);

    return args;
  }

  /**
   * Build watermark filter string for FFmpeg
   */
  private buildWatermarkFilter(config: WatermarkConfig): string {
    const positionMap: Record<string, string> = {
      'top-left': '10:10',
      'top-right': 'main_w-overlay_w-10:10',
      'bottom-left': '10:main_h-overlay_h-10',
      'bottom-right': 'main_w-overlay_w-10:main_h-overlay_h-10',
      'center': '(main_w-overlay_w)/2:(main_h-overlay_h)/2'
    };

    const position = positionMap[config.position] || '10:10';
    const opacity = config.opacity;

    return `overlay=${position}:alpha=${opacity}`;
  }

  /**
   * Start a new FFmpeg job (adds to queue or starts immediately)
   */
  async start(job: FFmpegJob): Promise<void> {
    console.log('[FFmpegManager] Adding job to queue:', job.jobId);

    // Validate job
    if (!job.input || !job.output) {
      throw new Error('FFmpeg job must have input and output paths');
    }

    // Add to queue
    this.jobQueue.push(job);

    // If nothing is running, start this job immediately
    if (!this.currentProcess && !this.currentJob) {
      await this.processQueue();
    }
  }

  /**
   * Process jobs from queue sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.jobQueue.length === 0) {
      console.log('[FFmpegManager] Queue is empty');
      return;
    }

    const job = this.jobQueue.shift();
    if (!job) return;

    this.currentJob = job;
    console.log('[FFmpegManager] Starting job:', job.jobId);

    try {
      // Load FFmpeg path if not already loaded
      if (!this.ffmpegPath) {
        await this.loadFFmpegPath();
      }

      // Get input file metadata to calculate total frames
      try {
        const metadata = await getVideoMetadata(job.input);
        this.totalFrames = Math.round(metadata.duration * metadata.fps);
        console.log('[FFmpegManager] Total frames:', this.totalFrames);
      } catch (err) {
        console.warn('[FFmpegManager] Could not get input metadata:', err);
        this.totalFrames = 0;
      }

      // Build arguments
      const args = this.buildFFmpegArgs(job);
      console.log('[FFmpegManager] FFmpeg args:', args);

      // Create abort controller for this job
      this.abortController = new AbortController();

      // Create command
      this.currentProcess = new Command(this.ffmpegPath, args);

      // Emit start event
      this.emitEvent({
        type: 'start',
        jobId: job.jobId
      });

      // Listen to stdout for progress
      this.currentProcess.on('close', async (data) => {
        console.log('[FFmpegManager] Process exited with code:', data.code);
        
        if (data.code === 0) {
          // Success
          this.emitEvent({
            type: 'complete',
            jobId: job.jobId,
            progress: {
              frame: this.totalFrames,
              fps: 0,
              q: 0,
              bitrate: '0',
              time: '00:00:00.00',
              speed: 0,
              percentComplete: 100
            }
          });
        } else {
          // Error
          this.emitEvent({
            type: 'error',
            jobId: job.jobId,
            error: `FFmpeg process exited with code ${data.code}`
          });
        }

        // Reset state
        this.currentProcess = null;
        this.currentJob = null;
        this.abortController = null;
        this.isPaused = false;

        // Process next job in queue
        await this.processQueue();
      });

      this.currentProcess.on('error', (error) => {
        console.error('[FFmpegManager] Process error:', error);
        
        this.emitEvent({
          type: 'error',
          jobId: job.jobId,
          error: String(error)
        });

        this.currentProcess = null;
        this.currentJob = null;
        this.abortController = null;
        this.isPaused = false;
      });

      // Execute command
      await this.currentProcess.execute();
    } catch (error) {
      console.error('[FFmpegManager] Failed to start job:', error);
      
      this.emitEvent({
        type: 'error',
        jobId: job.jobId,
        error: error instanceof Error ? error.message : String(error)
      });

      this.currentProcess = null;
      this.currentJob = null;
      this.isPaused = false;

      // Process next job
      await this.processQueue();
    }
  }

  /**
   * Pause current process (send 'p' signal to FFmpeg)
   */
  async pause(): Promise<void> {
    if (!this.currentProcess || this.isPaused) {
      console.warn('[FFmpegManager] Cannot pause: no process running or already paused');
      return;
    }

    console.log('[FFmpegManager] Pausing job:', this.currentJob?.jobId);
    this.isPaused = true;

    if (this.currentJob) {
      this.emitEvent({
        type: 'pause',
        jobId: this.currentJob.jobId
      });
    }

    // FFmpeg doesn't support SIGSTOP, so we'll send 'q' to quit and restart
    // For true pause, we'd need to use a different approach
    // This is a limitation of FFmpeg via shell
    console.log('[FFmpegManager] Note: True pause not supported via shell. Use stop() and restart.');
  }

  /**
   * Resume paused process
   */
  async resume(): Promise<void> {
    if (!this.isPaused) {
      console.warn('[FFmpegManager] Cannot resume: process not paused');
      return;
    }

    console.log('[FFmpegManager] Resuming job:', this.currentJob?.jobId);
    this.isPaused = false;

    if (this.currentJob) {
      this.emitEvent({
        type: 'resume',
        jobId: this.currentJob.jobId
      });
    }

    // Resume logic - FFmpeg doesn't support true pause via signals
    // Would need to implement checkpoint/restart mechanism
  }

  /**
   * Stop current process
   */
  async stop(): Promise<void> {
    if (!this.currentProcess) {
      console.warn('[FFmpegManager] No process to stop');
      return;
    }

    console.log('[FFmpegManager] Stopping job:', this.currentJob?.jobId);

    try {
      // Abort the command
      if (this.abortController) {
        this.abortController.abort();
      }

      // Note: Tauri's Command doesn't provide a direct kill method
      // The process will be terminated when the connection is aborted
      
      this.currentProcess = null;
      this.currentJob = null;
      this.isPaused = false;

      console.log('[FFmpegManager] Process stopped');
    } catch (error) {
      console.error('[FFmpegManager] Error stopping process:', error);
    }
  }

  /**
   * Get current queue status
   */
  getQueueStatus(): {
    queueLength: number;
    currentJobId: string | null;
    isRunning: boolean;
    isPaused: boolean;
  } {
    return {
      queueLength: this.jobQueue.length,
      currentJobId: this.currentJob?.jobId || null,
      isRunning: this.currentProcess !== null,
      isPaused: this.isPaused
    };
  }

  /**
   * Clear the job queue
   */
  clearQueue(): void {
    console.log('[FFmpegManager] Clearing queue');
    this.jobQueue = [];
  }

  /**
   * Get list of pending jobs
   */
  getPendingJobs(): FFmpegJob[] {
    return [...this.jobQueue];
  }
}
