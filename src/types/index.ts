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
  resolution: string;
  crf: string;
  aspectRatio: string;
  preset: string;
}

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
