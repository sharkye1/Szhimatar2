/**
 * Audio Validation Utility
 * 
 * Implements codec-specific validation rules to prevent FFmpeg errors:
 * - Opus: 48kHz sample rate, 1-2 channels, 16-128k bitrate
 * - MP3: 44.1kHz sample rate, 1-2 channels, 64-192k bitrate
 * - Other codecs: standard validation
 * - Copy mode: no filters allowed
 */

import type { AudioSettings } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface CodecConstraints {
  // Sample rate constraints
  sampleRates: number[];
  defaultSampleRate: number;
  fixedSampleRate: boolean; // If true, user cannot change sample rate
  
  // Channel constraints  
  channels: number[];
  defaultChannels: number;
  fixedChannels: boolean; // If true, user cannot change channels
  
  // Bitrate constraints (in kbps)
  minBitrate: number;
  maxBitrate: number;
  defaultBitrate: number;
  bitrateOptions: number[];
  
  // Filter support
  supportsFilters: boolean;
  
  // FFmpeg encoder name
  encoderName: string;
}

export interface ValidationResult {
  isValid: boolean;
  correctedSettings: Partial<AudioSettings>;
  warnings: string[];
  errors: string[];
}

export interface AudioFiltersActive {
  volume: boolean;       // volume !== '100'
  gain: boolean;         // gain !== '0'
  normalization: boolean;
  pitch: boolean;        // pitch !== 0
  noiseReduction: boolean; // noiseReduction > 0
  equalizer: boolean;    // any band gain !== 0
  effects: boolean;      // any effect enabled
}

// ============================================================================
// Codec Constraints Configuration
// ============================================================================

export const CODEC_CONSTRAINTS: Record<string, CodecConstraints> = {
  opus: {
    sampleRates: [48000],
    defaultSampleRate: 48000,
    fixedSampleRate: true, // Opus ONLY works with 48kHz
    
    channels: [1, 2],
    defaultChannels: 2,
    fixedChannels: false,
    
    minBitrate: 16,
    maxBitrate: 128,
    defaultBitrate: 64,
    bitrateOptions: [16, 24, 32, 48, 64, 96, 128],
    
    supportsFilters: true,
    encoderName: 'libopus',
  },
  
  mp3: {
    sampleRates: [44100],
    defaultSampleRate: 44100,
    fixedSampleRate: true, // MP3 best compatibility at 44.1kHz
    
    channels: [1, 2],
    defaultChannels: 2,
    fixedChannels: false,
    
    minBitrate: 64,
    maxBitrate: 192,
    defaultBitrate: 128,
    bitrateOptions: [64, 96, 128, 160, 192],
    
    supportsFilters: true,
    encoderName: 'libmp3lame',
  },
  
  aac: {
    sampleRates: [22050, 44100, 48000, 96000],
    defaultSampleRate: 48000,
    fixedSampleRate: false,
    
    channels: [1, 2, 6, 8],
    defaultChannels: 2,
    fixedChannels: false,
    
    minBitrate: 32,
    maxBitrate: 512,
    defaultBitrate: 192,
    bitrateOptions: [64, 96, 128, 192, 256, 320, 384, 448, 512],
    
    supportsFilters: true,
    encoderName: 'aac',
  },
  
  vorbis: {
    sampleRates: [22050, 44100, 48000],
    defaultSampleRate: 48000,
    fixedSampleRate: false,
    
    channels: [1, 2],
    defaultChannels: 2,
    fixedChannels: false,
    
    minBitrate: 32,
    maxBitrate: 500,
    defaultBitrate: 128,
    bitrateOptions: [64, 96, 128, 192, 256, 320, 384, 448, 500],
    
    supportsFilters: true,
    encoderName: 'libvorbis',
  },
  
  flac: {
    sampleRates: [22050, 44100, 48000, 96000, 192000],
    defaultSampleRate: 48000,
    fixedSampleRate: false,
    
    channels: [1, 2, 6, 8],
    defaultChannels: 2,
    fixedChannels: false,
    
    minBitrate: 0, // FLAC is lossless, bitrate not applicable
    maxBitrate: 0,
    defaultBitrate: 0,
    bitrateOptions: [],
    
    supportsFilters: true,
    encoderName: 'flac',
  },
  
  copy: {
    sampleRates: [],
    defaultSampleRate: 0,
    fixedSampleRate: true,
    
    channels: [],
    defaultChannels: 0,
    fixedChannels: true,
    
    minBitrate: 0,
    maxBitrate: 0,
    defaultBitrate: 0,
    bitrateOptions: [],
    
    supportsFilters: false, // Copy mode NEVER supports filters
    encoderName: 'copy',
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get constraints for a specific codec
 */
export function getCodecConstraints(codec: string): CodecConstraints {
  return CODEC_CONSTRAINTS[codec] || CODEC_CONSTRAINTS.aac;
}

/**
 * Check if any audio filters are active in the settings
 */
export function getActiveFilters(settings: AudioSettings): AudioFiltersActive {
  return {
    volume: settings.volume !== '100',
    gain: settings.gain !== '0',
    normalization: settings.normalization === true,
    pitch: settings.pitch !== 0,
    noiseReduction: parseFloat(settings.noiseReduction || '0') > 0,
    equalizer: settings.equalizer?.some(band => band.gain !== 0) || false,
    effects: settings.effects?.some(effect => effect.enabled) || false,
  };
}

/**
 * Check if any filter is active
 */
export function hasActiveFilters(settings: AudioSettings): boolean {
  const filters = getActiveFilters(settings);
  return Object.values(filters).some(v => v);
}

/**
 * Get list of active filter names (for display)
 */
export function getActiveFilterNames(settings: AudioSettings): string[] {
  const filters = getActiveFilters(settings);
  const names: string[] = [];
  
  if (filters.volume) names.push('volume');
  if (filters.gain) names.push('gain');
  if (filters.normalization) names.push('loudnorm');
  if (filters.pitch) names.push('pitch');
  if (filters.noiseReduction) names.push('noise reduction');
  if (filters.equalizer) names.push('equalizer');
  if (filters.effects) names.push('effects');
  
  return names;
}

/**
 * Clamp bitrate to valid range for codec
 */
export function clampBitrate(bitrate: number, constraints: CodecConstraints): number {
  if (constraints.bitrateOptions.length === 0) return 0;
  
  // Clamp to min/max range
  const clamped = Math.max(constraints.minBitrate, Math.min(constraints.maxBitrate, bitrate));
  
  // Find closest valid bitrate option
  return constraints.bitrateOptions.reduce((prev, curr) => 
    Math.abs(curr - clamped) < Math.abs(prev - clamped) ? curr : prev
  );
}

/**
 * Get valid sample rate for codec
 */
export function getValidSampleRate(sampleRate: number, constraints: CodecConstraints): number {
  if (constraints.sampleRates.length === 0) return sampleRate;
  if (constraints.fixedSampleRate) return constraints.defaultSampleRate;
  
  // Find closest valid sample rate
  return constraints.sampleRates.reduce((prev, curr) => 
    Math.abs(curr - sampleRate) < Math.abs(prev - sampleRate) ? curr : prev
  );
}

/**
 * Get valid channels for codec
 */
export function getValidChannels(channels: number, constraints: CodecConstraints): number {
  if (constraints.channels.length === 0) return channels;
  
  // Find closest valid channel count
  const validChannels = constraints.channels.includes(channels) 
    ? channels 
    : constraints.channels.reduce((prev, curr) => 
        Math.abs(curr - channels) < Math.abs(prev - channels) ? curr : prev
      );
  
  return validChannels;
}

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Validate and correct audio settings based on codec constraints
 * Returns corrected settings and any warnings/errors
 */
export function validateAudioSettings(settings: AudioSettings): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const correctedSettings: Partial<AudioSettings> = {};
  
  const constraints = getCodecConstraints(settings.codec);
  const filtersActive = hasActiveFilters(settings);
  
  // ========== COPY MODE VALIDATION ==========
  if (settings.codec === 'copy') {
    if (filtersActive) {
      // Cannot use filters with copy mode
      errors.push(`audioValidation.errorCopyWithFilters`);
      warnings.push(`audioValidation.warningFiltersDisabled`);
      
      // Force disable all filters
      correctedSettings.volume = '100';
      correctedSettings.gain = '0';
      correctedSettings.normalization = false;
      correctedSettings.pitch = 0;
      correctedSettings.noiseReduction = '0';
      correctedSettings.equalizer = settings.equalizer?.map(band => ({ ...band, gain: 0 }));
      correctedSettings.effects = settings.effects?.map(effect => ({ ...effect, enabled: false }));
    }
    
    return {
      isValid: !filtersActive,
      correctedSettings,
      warnings,
      errors,
    };
  }
  
  // ========== SAMPLE RATE VALIDATION ==========
  const currentSampleRate = parseInt(settings.sampleRate, 10);
  const validSampleRate = getValidSampleRate(currentSampleRate, constraints);
  
  if (currentSampleRate !== validSampleRate) {
    correctedSettings.sampleRate = validSampleRate.toString();
    warnings.push(`audioValidation.warningSampleRate`);
  }
  
  // ========== CHANNELS VALIDATION ==========
  const currentChannels = parseInt(settings.channels, 10);
  const validChannels = getValidChannels(currentChannels, constraints);
  
  if (currentChannels !== validChannels) {
    correctedSettings.channels = validChannels.toString();
    warnings.push(`audioValidation.warningChannels`);
  }
  
  // ========== BITRATE VALIDATION ==========
  if (constraints.bitrateOptions.length > 0) {
    const currentBitrate = parseInt(settings.bitrate, 10);
    const validBitrate = clampBitrate(currentBitrate, constraints);
    
    if (currentBitrate !== validBitrate) {
      correctedSettings.bitrate = validBitrate.toString();
      warnings.push(`audioValidation.warningBitrate`);
    }
  }
  
  // ========== FILTER + COPY PREVENTION ==========
  // If filters are active, ensure we're not using 'copy' codec
  // (This is already handled above, but double-check here)
  if (filtersActive && settings.codec === 'copy') {
    errors.push(`audioValidation.errorNormalizationCopy`);
  }
  
  const hasCorrections = Object.keys(correctedSettings).length > 0;
  
  return {
    isValid: errors.length === 0 && !hasCorrections,
    correctedSettings,
    warnings,
    errors,
  };
}

/**
 * Get default settings for a codec (for use when switching codecs)
 */
export function getCodecDefaults(codec: string): Partial<AudioSettings> {
  const constraints = getCodecConstraints(codec);
  
  if (codec === 'copy') {
    return {
      codec: 'copy',
      // Don't change other settings, but they will be ignored anyway
    };
  }
  
  return {
    codec,
    sampleRate: constraints.defaultSampleRate.toString(),
    channels: constraints.defaultChannels.toString(),
    bitrate: constraints.defaultBitrate.toString(),
  };
}

/**
 * Apply codec constraints to existing settings (on codec change)
 */
export function applyCodecConstraints(settings: AudioSettings, newCodec: string): AudioSettings {
  const constraints = getCodecConstraints(newCodec);
  const corrected = { ...settings, codec: newCodec };
  
  if (newCodec === 'copy') {
    // Copy mode: disable all filters
    corrected.volume = '100';
    corrected.gain = '0';
    corrected.normalization = false;
    corrected.pitch = 0;
    corrected.noiseReduction = '0';
    corrected.equalizer = settings.equalizer?.map(band => ({ ...band, gain: 0 }));
    corrected.effects = settings.effects?.map(effect => ({ ...effect, enabled: false }));
    return corrected;
  }
  
  // Apply sample rate constraint
  if (constraints.fixedSampleRate || constraints.sampleRates.length > 0) {
    const currentRate = parseInt(settings.sampleRate, 10);
    const validRate = getValidSampleRate(currentRate, constraints);
    corrected.sampleRate = validRate.toString();
  }
  
  // Apply channels constraint
  if (constraints.channels.length > 0) {
    const currentChannels = parseInt(settings.channels, 10);
    const validChannels = getValidChannels(currentChannels, constraints);
    corrected.channels = validChannels.toString();
  }
  
  // Apply bitrate constraint
  if (constraints.bitrateOptions.length > 0) {
    const currentBitrate = parseInt(settings.bitrate, 10);
    const validBitrate = clampBitrate(currentBitrate, constraints);
    corrected.bitrate = validBitrate.toString();
  }
  
  return corrected;
}

/**
 * Get allowed options for UI dropdowns based on current codec
 */
export function getCodecOptions(codec: string): {
  sampleRates: { label: string; value: string }[];
  channels: { label: string; value: string }[];
  bitrates: { label: string; value: string }[];
  sampleRateDisabled: boolean;
  channelsDisabled: boolean;
  bitrateDisabled: boolean;
} {
  const constraints = getCodecConstraints(codec);
  
  // Sample rates
  const sampleRates = constraints.sampleRates.length > 0
    ? constraints.sampleRates.map(sr => ({ label: `${sr} Hz`, value: sr.toString() }))
    : [
        { label: '22050 Hz', value: '22050' },
        { label: '44100 Hz', value: '44100' },
        { label: '48000 Hz', value: '48000' },
        { label: '96000 Hz', value: '96000' },
      ];
  
  // Channels
  const channelLabels: Record<number, string> = {
    1: 'Mono',
    2: 'Stereo',
    6: '5.1',
    8: '7.1',
  };
  
  const channels = constraints.channels.length > 0
    ? constraints.channels.map(ch => ({ 
        label: channelLabels[ch] || ch.toString(), 
        value: ch.toString() 
      }))
    : [
        { label: 'Mono', value: '1' },
        { label: 'Stereo', value: '2' },
        { label: '5.1', value: '6' },
        { label: '7.1', value: '8' },
      ];
  
  // Bitrates
  const bitrates = constraints.bitrateOptions.length > 0
    ? constraints.bitrateOptions.map(br => ({ label: br.toString(), value: br.toString() }))
    : [
        { label: '64', value: '64' },
        { label: '96', value: '96' },
        { label: '128', value: '128' },
        { label: '192', value: '192' },
        { label: '256', value: '256' },
        { label: '320', value: '320' },
      ];
  
  return {
    sampleRates,
    channels,
    bitrates,
    sampleRateDisabled: codec === 'copy' || constraints.fixedSampleRate,
    channelsDisabled: codec === 'copy',
    bitrateDisabled: codec === 'copy' || codec === 'flac',
  };
}

/**
 * Final validation before FFmpeg command building
 * This is the last line of defense before rendering
 */
export function validateForRender(settings: AudioSettings): {
  valid: boolean;
  settings: AudioSettings;
  error?: string;
} {
  const filtersActive = hasActiveFilters(settings);
  
  // Error case: copy with filters
  if (settings.codec === 'copy' && filtersActive) {
    return {
      valid: false,
      settings,
      error: 'Audio normalization/filters not supported with codec "copy"',
    };
  }
  
  // Auto-correct settings for render
  const corrected = applyCodecConstraints(settings, settings.codec);
  
  return {
    valid: true,
    settings: corrected,
  };
}

/**
 * Get FFmpeg audio arguments with proper validation
 * Returns validated arguments that won't cause FFmpeg errors
 */
export function buildValidatedAudioArgs(settings: AudioSettings): {
  args: string[];
  encoder: string;
  filters: string[];
} {
  const constraints = getCodecConstraints(settings.codec);
  const filtersActive = hasActiveFilters(settings);
  
  const args: string[] = [];
  const filters: string[] = [];
  
  // Determine encoder
  if (settings.codec === 'copy') {
    if (filtersActive) {
      // CRITICAL: Cannot use copy with filters, fall back to AAC
      console.warn('[AudioValidation] Filters active with copy codec, forcing AAC encoder');
      args.push('-c:a', 'aac');
      args.push('-b:a', '192k');
      args.push('-ac', '2');
      args.push('-ar', '48000');
    } else {
      args.push('-c:a', 'copy');
      return { args, encoder: 'copy', filters: [] };
    }
  } else {
    args.push('-c:a', constraints.encoderName);
    
    // Sample rate (always use validated value)
    const validSampleRate = getValidSampleRate(
      parseInt(settings.sampleRate, 10), 
      constraints
    );
    args.push('-ar', validSampleRate.toString());
    
    // Channels (always use validated value)
    const validChannels = getValidChannels(
      parseInt(settings.channels, 10), 
      constraints
    );
    args.push('-ac', validChannels.toString());
    
    // Bitrate (if applicable)
    if (constraints.bitrateOptions.length > 0) {
      const validBitrate = clampBitrate(
        parseInt(settings.bitrate, 10), 
        constraints
      );
      args.push('-b:a', `${validBitrate}k`);
    }
  }
  
  // Build audio filters
  if (settings.codec !== 'copy') {
    // Volume
    if (settings.volume && settings.volume !== '100') {
      const volumeFloat = Math.max(0, Math.min(10, parseFloat(settings.volume) / 100));
      if (volumeFloat !== 1.0) {
        filters.push(`volume=${volumeFloat.toFixed(2)}`);
      }
    }
    
    // Gain
    if (settings.gain && settings.gain !== '0') {
      const gainValue = Math.max(-20, Math.min(20, parseFloat(settings.gain)));
      if (gainValue !== 0) {
        filters.push(`volume=${gainValue}dB`);
      }
    }
    
    // Normalization
    if (settings.normalization) {
      filters.push('loudnorm=I=-16:LRA=11:TP=-1.5');
    }
    
    // Pitch
    if (settings.pitch && settings.pitch !== 0) {
      const semitones = Math.max(-12, Math.min(12, settings.pitch));
      const pitchFactor = Math.pow(2, semitones / 12);
      filters.push(`rubberband=pitch=${pitchFactor.toFixed(6)}`);
    }
    
    // Noise reduction
    if (settings.noiseReduction && parseFloat(settings.noiseReduction) > 0) {
      const nrLevel = Math.max(0, Math.min(1, parseFloat(settings.noiseReduction)));
      const noiseFloor = Math.round(-80 + (nrLevel * 60));
      const clampedNf = Math.max(-80, Math.min(-20, noiseFloor));
      filters.push(`afftdn=nf=${clampedNf}`);
    }
    
    // Equalizer
    if (settings.equalizer) {
      for (const band of settings.equalizer) {
        if (band.gain !== 0) {
          filters.push(`equalizer=f=${band.frequency}:width_type=o:width=2:g=${band.gain}`);
        }
      }
    }
    
    // Effects
    if (settings.effects) {
      for (const effect of settings.effects) {
        if (effect.enabled) {
          switch (effect.name) {
            case 'reverb':
              filters.push('aecho=0.8:0.9:1000:0.3');
              break;
            case 'chorus':
              filters.push('chorus=0.5:0.9:50:0.4:0.25:2');
              break;
            case 'compressor':
              filters.push('acompressor=threshold=0.5:ratio=4:attack=5:release=50');
              break;
          }
        }
      }
    }
  }
  
  return { 
    args, 
    encoder: settings.codec === 'copy' ? 'copy' : constraints.encoderName,
    filters,
  };
}
