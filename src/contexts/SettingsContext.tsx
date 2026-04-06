import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/tauri';

export type ScreenAnimationType = 'default' | 'soft-blur' | 'physics' | 'scale-fade' | 'none';

interface SettingsContextType {
  screenAnimation: ScreenAnimationType;
  setScreenAnimation: (animation: ScreenAnimationType) => void;
  performanceMode: boolean;
  setPerformanceMode: (enabled: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

interface SettingsProviderProps {
  children: ReactNode;
}

export const SettingsProvider: React.FC<SettingsProviderProps> = ({ children }) => {
  const [screenAnimation, setScreenAnimationState] = useState<ScreenAnimationType>('default');
  const [performanceMode, setPerformanceModeState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('performanceMode') === 'true';
    } catch {
      return false;
    }
  });

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await invoke<any>('load_settings');
        if (settings.screenAnimation) {
          setScreenAnimationState(settings.screenAnimation as ScreenAnimationType);
        } else if (settings.screen_animation) {
          setScreenAnimationState(settings.screen_animation as ScreenAnimationType);
        }
        if (settings.performanceMode !== undefined) {
          setPerformanceMode(!!settings.performanceMode);
        } else if (settings.performance_mode !== undefined) {
          setPerformanceMode(!!settings.performance_mode);
        }
      } catch (error) {
        console.error('Failed to load screen animation setting:', error);
      }
    };
    loadSettings();
  }, []);

  const setScreenAnimation = (animation: ScreenAnimationType) => {
    setScreenAnimationState(animation);
  };

  const setPerformanceMode = (enabled: boolean) => {
    setPerformanceModeState(enabled);
    try {
      localStorage.setItem('performanceMode', enabled ? 'true' : 'false');
    } catch {
      // Ignore storage errors in restricted environments
    }
  };

  useEffect(() => {
    const root = document.documentElement;
    if (performanceMode) {
      root.classList.add('performance-mode');
    } else {
      root.classList.remove('performance-mode');
    }
  }, [performanceMode]);

  return (
    <SettingsContext.Provider value={{ screenAnimation, setScreenAnimation, performanceMode, setPerformanceMode }}>
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
