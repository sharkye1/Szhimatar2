/**
 * Video Validation Utility
 * 
 * Implements codec-, encoder- and content-specific validation rules to prevent FFmpeg errors
 * and ensure maximum compression efficiency.
 */

import type { VideoSettings } from '../types';

export interface VideoValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  settings: VideoSettings;
}

/**
 * Validate and normalize VideoSettings before building FFmpeg commands or UI display
 */
export function validateVideoSettings(
  settings: VideoSettings,
  preferGpu: boolean = false
): VideoValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalized: VideoSettings = { ...settings };

  const codec = (normalized.codec || 'h264').toLowerCase();
  const isNvenc = preferGpu && (codec === 'h264' || codec === 'h265' || codec === 'hevc');
  const rateControlMode = normalized.rateControlMode || 'crf';

  // 1. Validate Rate Control & CRF
  if (rateControlMode === 'crf' || rateControlMode === 'constrained_crf') {
    const rawCrf = parseInt(normalized.crf, 10);
    const maxCrf = (codec === 'vp9' || codec === 'av1') ? 63 : 51;
    
    if (isNaN(rawCrf)) {
      normalized.crf = '23';
      warnings.push(`CRF was invalid, set to default 23.`);
    } else if (rawCrf < 0 || rawCrf > maxCrf) {
      const clampedCrf = Math.max(0, Math.min(maxCrf, rawCrf));
      normalized.crf = clampedCrf.toString();
      warnings.push(`CRF ${rawCrf} out of range (0-${maxCrf}) for ${codec.toUpperCase()}, clamped to ${clampedCrf}.`);
    }
  }

  // 2. Validate Bitrate for VBR / CBR / Constrained CRF
  if (rateControlMode === 'vbr' || rateControlMode === 'cbr' || rateControlMode === 'constrained_crf') {
    const rawBitrate = parseFloat(normalized.bitrate);
    if (isNaN(rawBitrate) || rawBitrate <= 0) {
      normalized.bitrate = '5';
      warnings.push(`Bitrate was invalid, set to default 5 Mbps.`);
    } else if (rawBitrate < 0.1) {
      normalized.bitrate = '0.1';
      warnings.push(`Bitrate too low, clamped to minimum 0.1 Mbps.`);
    } else if (rawBitrate > 200) {
      normalized.bitrate = '200';
      warnings.push(`Bitrate very high (>200 Mbps), clamped to 200 Mbps.`);
    }

    if (normalized.maxrate) {
      const maxrateVal = parseFloat(normalized.maxrate);
      const bitrateVal = parseFloat(normalized.bitrate);
      if (!isNaN(maxrateVal) && maxrateVal < bitrateVal) {
        normalized.maxrate = normalized.bitrate;
        warnings.push(`Maxrate cannot be less than target bitrate, adjusted to ${normalized.bitrate} Mbps.`);
      }
    }
  }

  // 3. Low FPS vs Bitrate heuristic warning (static presentation/webinar)
  const fpsNum = parseFloat(normalized.fps);
  if (!isNaN(fpsNum) && fpsNum <= 5 && !normalized.fpsAuto) {
    if (rateControlMode === 'vbr' || rateControlMode === 'cbr') {
      const bitrateVal = parseFloat(normalized.bitrate || '0');
      if (bitrateVal >= 0.8) {
        warnings.push(
          `Low FPS (${fpsNum} fps) with target bitrate ${bitrateVal} Mbps may produce unnecessarily large files on static slides. Consider CRF mode.`
        );
      }
    }
  }

  // 4. Resolution parity check (must be even for NVENC and modern codecs)
  if (normalized.resolution && normalized.resolution !== 'original' && normalized.resolution !== 'source') {
    const parts = normalized.resolution.split('x').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      const evenW = Math.floor(parts[0] / 2) * 2;
      const evenH = Math.floor(parts[1] / 2) * 2;
      if (evenW !== parts[0] || evenH !== parts[1]) {
        normalized.resolution = `${evenW}x${evenH}`;
        warnings.push(`Resolution adjusted to ${evenW}x${evenH} (even dimensions required by encoders).`);
      }
    }
  }

  // 5. Tune compatibility check
  if (isNvenc && normalized.tune) {
    const cpuOnlyTunes = ['film', 'animation', 'grain', 'stillimage', 'fastdecode'];
    if (cpuOnlyTunes.includes(normalized.tune)) {
      // NVENC uses 'hq', 'll', 'ull' - CPU tunes will be mapped automatically without throwing
    }
  }

  // 6. B-Frames limit validation (NVENC hardware limit is max 4)
  if (isNvenc && normalized.bFrames !== undefined && normalized.bFrames > 4) {
    normalized.bFrames = 4;
    warnings.push('NVENC hardware encoder supports a maximum of 4 B-frames. Automatically adjusted to 4.');
  }

  // 7. HW Decoding normalization
  if (!normalized.hwaccel) {
    normalized.hwaccel = 'auto';
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    settings: normalized,
  };
}
