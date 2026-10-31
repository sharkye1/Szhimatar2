/**
 * E2E Test Suite - Architectural Contracts and Interface Specifications
 * Derived from ORIGINAL_REQUEST.md and PROJECT.md
 */

export type PlatformOS = 'macos' | 'windows' | 'linux' | 'unknown';
export type RenderMode = 'cpu' | 'gpu' | 'duo';
export type RenderSlot = 'cpu' | 'gpu';
export type TargetFormat = 'video' | 'gif';
export type RateControlMode = 'crf' | 'constrained_crf' | 'vbr' | 'cbr';

export interface HardwareInfo {
  cpu_vendor: string;
  cpu_brand?: string;
  gpu_vendor?: string;
  gpu_available?: boolean;
  gpu_name?: string;
}

export interface HardwareOverride {
  enabled: boolean;
  cpu_vendor: string;
  gpu_vendor: string;
  gpu_available: boolean;
}

export interface PreviewSettingsContract {
  video_path: string;
  time_seconds: number;
  duration?: number;
  codec: string;
  crf: string;
  bitrate?: string;
  maxrate?: string;
  rate_control_mode?: RateControlMode;
  prefer_gpu?: boolean;
  resampling_enabled?: boolean;
  fps?: string;
  width?: number;
  height?: number;
}

export interface VideoSettingsContract {
  codec: string;
  crf: number;
  bitrate?: number;
  maxrate?: number;
  rateControlMode?: RateControlMode;
  preset?: string;
  hwaccel?: string;
  fps?: string;
  fpsAuto?: boolean;
  width?: number;
  height?: number;
  bFrames?: number;
  targetFormat?: TargetFormat;
  nvencMultipass?: string;
  gopSize?: string;
  contentType?: string;
  customResolution?: boolean;
  scaleFilter?: string;
  keepAudio?: boolean;
}

export interface AudioSettingsContract {
  codec: string;
  bitrate: string;
  sampleRate: string;
  channels: string;
  volume: number;
  normalizeAudio: boolean;
}

export const FORBIDDEN_VIDEOTOOLBOX_FLAGS = [
  '-spatial-aq',
  '-temporal-aq',
  '-cq',
  '-multipass',
  '-rc',
  '-tune',
  '-b_ref_mode',
] as const;

export const NVENC_PRESET_PREFIX = /^p[1-7]$/;

export const VIDEOTOOLBOX_ENCODERS = {
  h264: 'h264_videotoolbox',
  h265: 'hevc_videotoolbox',
  hevc: 'hevc_videotoolbox',
  prores: 'prores_videotoolbox',
} as const;

export const NVENC_ENCODERS = {
  h264: 'h264_nvenc',
  h265: 'hevc_nvenc',
  hevc: 'hevc_nvenc',
} as const;

export const CPU_ENCODERS = {
  h264: 'libx264',
  h265: 'libx265',
  hevc: 'libx265',
  vp9: 'libvpx-vp9',
  vp8: 'libvpx',
  av1: 'libaom-av1',
} as const;

/**
 * Authoritative mathematical specification for VideoToolbox quality mapping:
 * Maps CRF scale (0 = highest quality, 51 = lowest quality)
 * to VideoToolbox -q:v scale (1 = lowest quality, 100 = highest quality).
 * Formula: clamp(Math.round(((51 - crf) * 100) / 51), 1, 100)
 */
export function calculateVideoToolboxQuality(crf: number): number {
  if (isNaN(crf)) return 55; // Default for CRF 23
  const rawQuality = Math.round(((51 - crf) * 100) / 51);
  return Math.max(1, Math.min(100, rawQuality));
}

/**
 * Authoritative mode sanitization specification:
 * On macOS, 'duo' is sanitized to 'gpu' (or 'cpu' if gpuAvailable is false).
 * On Windows, 'duo' is preserved if gpuAvailable is true.
 */
export function sanitizeRenderMode(mode: RenderMode, isMac: boolean, gpuAvailable: boolean): RenderMode {
  const validModes: RenderMode[] = ['cpu', 'gpu', 'duo'];
  const baseMode = validModes.includes(mode) ? mode : 'cpu';

  if (isMac) {
    if (baseMode === 'duo') {
      return gpuAvailable ? 'gpu' : 'cpu';
    }
    if (baseMode === 'gpu' && !gpuAvailable) {
      return 'cpu';
    }
    return baseMode;
  }
  // Windows / Linux
  if (baseMode === 'duo' && !gpuAvailable) {
    return 'cpu';
  }
  if (baseMode === 'gpu' && !gpuAvailable) {
    return 'cpu';
  }
  return baseMode;
}
