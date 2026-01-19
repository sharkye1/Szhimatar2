export interface Settings {
  theme: string;
  language: string;
  ffmpeg_path: string;
  ffprobe_path: string;
  output_suffix: string;
  default_video_codec: string;
  default_audio_codec: string;
}

export interface VideoSettings {
  codec: string;
  bitrate: string;
  fps: string;
  fpsAuto: boolean;           // Auto-detect FPS from metadata
  resolution: string;
  aspectRatio: string;        // 16:9, 4:3, 21:9, etc.
  crf: string;
  preset: string;
  speed: number;              // 0.25 to 2.0 (slow to fast)
  rotation: 'none' | '90' | '180' | '270';
  flip: 'none' | 'horizontal' | 'vertical';
  filters: VideoFilter[];     // Array of enabled filters
}

export interface VideoFilter {
  name: string;
  enabled: boolean;
  // Future: parameters for each filter
}

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  codec: 'h264',
  bitrate: '5',
  fps: '30',
  fpsAuto: false,
  resolution: '1920x1080',
  aspectRatio: '16:9',
  crf: '23',
  preset: 'medium',
  speed: 1.0,
  rotation: 'none',
  flip: 'none',
  filters: [
    { name: 'deinterlace', enabled: false },
    { name: 'denoise', enabled: false },
    { name: 'sharpen', enabled: false },
  ],
};

export interface AudioEffect {
  name: string;
  enabled: boolean;
}

export interface EqualizerBand {
  frequency: number;  // Hz (e.g., 60, 250, 1000, 4000, 16000)
  gain: number;       // dB (-12 to +12)
}

export interface AudioSettings {
  codec: string;
  bitrate: string;
  channels: string;
  sampleRate: string;
  volume: string;           // 0-200 (%)
  gain: string;             // -20 to +20 dB
  normalization: boolean;   // Enable/disable normalization
  pitch: number;            // -12 to +12 semitones
  noiseReduction: string;   // 0-1 (0=off, 1=max)
  autoSelect: boolean;      // Auto-detect from metadata
  effects: AudioEffect[];   // reverb, chorus, compressor, etc.
  equalizer: EqualizerBand[];  // 5-band EQ
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  codec: 'aac',
  bitrate: '192',
  channels: '2',
  sampleRate: '48000',
  volume: '100',
  gain: '0',
  normalization: false,
  pitch: 0,
  noiseReduction: '0',
  autoSelect: false,
  effects: [
    { name: 'reverb', enabled: false },
    { name: 'chorus', enabled: false },
    { name: 'compressor', enabled: false },
  ],
  equalizer: [
    { frequency: 60, gain: 0 },
    { frequency: 250, gain: 0 },
    { frequency: 1000, gain: 0 },
    { frequency: 4000, gain: 0 },
    { frequency: 16000, gain: 0 },
  ],
};

export interface WatermarkSettings {
  enabled: boolean;
  imagePath: string;
  position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center';
  opacity: number;
}

export const DEFAULT_WATERMARK_SETTINGS: WatermarkSettings = {
  enabled: false,
  imagePath: '',
  position: 'bottomRight',
  opacity: 100,
};

export interface QueueItem {
  id: number;
  name: string;
  path: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  error?: string;
}

export interface Theme {
  name: string;
  colors: {
    background: string;
    surface: string;
    primary: string;
    secondary: string;
    text: string;
    textSecondary: string;
    border: string;
    success: string;
    warning: string;
    error: string;
    hover: string;
  };
}

export interface Translations {
  [key: string]: string | Translations;
}

// Main screen settings (save path and checkbox state)
export interface MainScreenSettings {
  saveInSourceDirectory: boolean;
  customOutputPath: string;
}

export const DEFAULT_MAIN_SCREEN_SETTINGS: MainScreenSettings = {
  saveInSourceDirectory: true,
  customOutputPath: '',
};

// Complete application preset
export interface AppPreset {
  name: string;                       // Display name of preset
  description?: string;               // Optional description
  video: VideoSettings;               // All video settings
  audio: AudioSettings;               // All audio settings
  mainScreen: MainScreenSettings;     // Save path preferences
  watermark?: WatermarkSettings;      // Optional watermark settings
  createdAt?: string;                 // ISO timestamp
  modifiedAt?: string;                // ISO timestamp
  isDefault?: boolean;                // Marks preset as default (only one allowed)
}

// Preset metadata for listing
export interface PresetMetadata {
  name: string;
  description?: string;
  createdAt?: string;
  modifiedAt?: string;
  isDefault?: boolean;
}
