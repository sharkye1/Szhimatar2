import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/tauri';

export type ScreenAnimationType = 'default' | 'soft-blur' | 'physics' | 'scale-fade' | 'none';

interface SettingsContextType {
  screenAnimation: ScreenAnimationType;
  setScreenAnimation: (animation: ScreenAnimationType) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

interface SettingsProviderProps {
  children: ReactNode;
}

export const SettingsProvider: React.FC<SettingsProviderProps> = ({ children }) => {
  const [screenAnimation, setScreenAnimationState] = useState<ScreenAnimationType>('default');

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await invoke<any>('load_settings');
        if (settings.screenAnimation) {
          setScreenAnimationState(settings.screenAnimation as ScreenAnimationType);
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

  return (
    <SettingsContext.Provider value={{ screenAnimation, setScreenAnimation }}>
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
