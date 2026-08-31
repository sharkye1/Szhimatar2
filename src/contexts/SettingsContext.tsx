import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/tauri';

export type ScreenAnimationType = 'default' | 'soft-blur' | 'physics' | 'scale-fade' | 'none';

export interface AppSettings {
  theme: string;
  modifiedTheme: boolean;
  language: string;
  ffmpeg_path: string;
  ffprobe_path: string;
  output_suffix: string;
  use_background_image: boolean;
  background_image_path: string;
  glassOpacity: number;
  glassBlur: number;
  default_video_codec: string;
  default_audio_codec: string;
  gpuAvailable: boolean;
  renderMode: string;
  screenAnimation: ScreenAnimationType;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'light',
  modifiedTheme: false,
  language: 'ru',
  ffmpeg_path: 'ffmpeg',
  ffprobe_path: 'ffprobe',
  output_suffix: '_szhatoe',
  use_background_image: false,
  background_image_path: '',
  glassOpacity: 15,
  glassBlur: 12,
  default_video_codec: 'h264',
  default_audio_codec: 'aac',
  gpuAvailable: false,
  renderMode: 'cpu',
  screenAnimation: 'default',
};

interface SettingsContextType {
  settings: AppSettings;
  isLoaded: boolean;
  updateSettings: (partial: Partial<AppSettings>, immediate?: boolean) => void;
  flushSettings: () => Promise<void>;
  screenAnimation: ScreenAnimationType;
  setScreenAnimation: (animation: ScreenAnimationType) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

interface SettingsProviderProps {
  children: ReactNode;
}

export const SettingsProvider: React.FC<SettingsProviderProps> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const settingsRef = useRef<AppSettings>(DEFAULT_APP_SETTINGS);
  settingsRef.current = settings;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Write current in-memory settings to settings.json on disk
  const persistToDisk = useCallback(async (data: AppSettings) => {
    try {
      await invoke('save_settings', {
        settings: {
          theme: data.theme,
          modifiedTheme: data.modifiedTheme,
          language: data.language,
          ffmpeg_path: data.ffmpeg_path,
          ffprobe_path: data.ffprobe_path,
          output_suffix: data.output_suffix,
          use_background_image: data.use_background_image,
          background_image_path: data.background_image_path,
          glassOpacity: data.glassOpacity,
          glassBlur: data.glassBlur,
          default_video_codec: data.default_video_codec,
          default_audio_codec: data.default_audio_codec,
          gpuAvailable: data.gpuAvailable,
          renderMode: data.renderMode,
          screenAnimation: data.screenAnimation,
        },
      });
    } catch (error) {
      console.error('[SettingsContext] Failed to persist settings:', error);
    }
  }, []);

  // Load settings on app startup
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const raw = await invoke<any>('load_settings');
        const normalized: AppSettings = {
          theme: raw.theme || DEFAULT_APP_SETTINGS.theme,
          modifiedTheme: raw.modifiedTheme ?? raw.modified_theme ?? DEFAULT_APP_SETTINGS.modifiedTheme,
          language: raw.language || DEFAULT_APP_SETTINGS.language,
          ffmpeg_path: raw.ffmpeg_path || DEFAULT_APP_SETTINGS.ffmpeg_path,
          ffprobe_path: raw.ffprobe_path || DEFAULT_APP_SETTINGS.ffprobe_path,
          output_suffix: raw.output_suffix ?? DEFAULT_APP_SETTINGS.output_suffix,
          use_background_image: !!raw.use_background_image,
          background_image_path: raw.background_image_path || '',
          glassOpacity: raw.glassOpacity ?? raw.glass_opacity ?? DEFAULT_APP_SETTINGS.glassOpacity,
          glassBlur: raw.glassBlur ?? raw.glass_blur ?? DEFAULT_APP_SETTINGS.glassBlur,
          default_video_codec: raw.default_video_codec || DEFAULT_APP_SETTINGS.default_video_codec,
          default_audio_codec: raw.default_audio_codec || DEFAULT_APP_SETTINGS.default_audio_codec,
          gpuAvailable: !!raw.gpuAvailable,
          renderMode: raw.renderMode || DEFAULT_APP_SETTINGS.renderMode,
          screenAnimation: (raw.screenAnimation || raw.screen_animation || DEFAULT_APP_SETTINGS.screenAnimation) as ScreenAnimationType,
        };
        settingsRef.current = normalized;
        setSettings(normalized);
        setIsLoaded(true);
      } catch (error) {
        console.error('[SettingsContext] Failed to load settings:', error);
        setIsLoaded(true);
      }
    };

    loadSettings();
  }, []);

  // Flush any pending debounced changes on unmount or beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void persistToDisk(settingsRef.current);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void persistToDisk(settingsRef.current);
      }
    };
  }, [persistToDisk]);

  const updateSettings = useCallback(
    (partial: Partial<AppSettings>, immediate: boolean = false) => {
      const next = { ...settingsRef.current, ...partial };
      settingsRef.current = next;
      setSettings(next);

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      if (immediate) {
        void persistToDisk(next);
      } else {
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          void persistToDisk(settingsRef.current);
        }, 600);
      }
    },
    [persistToDisk]
  );

  const flushSettings = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await persistToDisk(settingsRef.current);
  }, [persistToDisk]);

  const setScreenAnimation = useCallback(
    (animation: ScreenAnimationType) => {
      updateSettings({ screenAnimation: animation }, true);
    },
    [updateSettings]
  );

  return (
    <SettingsContext.Provider
      value={{
        settings,
        isLoaded,
        updateSettings,
        flushSettings,
        screenAnimation: settings.screenAnimation,
        setScreenAnimation,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = (): SettingsContextType => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};

export default SettingsContext;
