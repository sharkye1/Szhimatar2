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

export interface AudioSettings {
  codec: string;
  bitrate: string;
  channels: string;
  sampleRate: string;
  volume: string;
}

export interface WatermarkSettings {
  enabled: boolean;
  imagePath: string;
  position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center';
  opacity: number;
}

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
