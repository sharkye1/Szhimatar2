import React, { createContext, useContext, useEffect, ReactNode } from 'react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { useSettings } from './SettingsContext';
import lightTheme from '../themes/light.json';
import darkRedTheme from '../themes/dark-red.json';
import blueOceanTheme from '../themes/blue-ocean.json';
import darkBlueTheme from '../themes/dark-blue.json';
import darkOrangeTheme from '../themes/dark-orange.json';
import darkGreenTheme from '../themes/dark-green.json';
import purplePinkTheme from '../themes/purple-pink.json';
import darkGrayTheme from '../themes/dark-gray.json';
import pinkTheme from '../themes/pink.json';
import sunnyYellowTheme from '../themes/sunny-yellow.json';
import mintGlassTheme from '../themes/mint-glass.json';
import paperSepiaTheme from '../themes/paper-sepia.json';
import nordSoftTheme from '../themes/nord-soft.json';
import graphiteLightTheme from '../themes/graphite-light.json';
import amoledNightTheme from '../themes/amoled-night.json';
import catppuccinMochaTheme from '../themes/catppuccin-mocha.json';
import everforestTheme from '../themes/everforest.json';
import tokyoNightTheme from '../themes/tokyo-night.json';
import warmAmberTheme from '../themes/warm-amber.json';

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

interface ThemeContextType {
  theme: Theme;
  themeName: string;
  modifiedTheme: boolean;
  setTheme: (name: string) => void;
  setModifiedTheme: (value: boolean) => void;
  useImageBackground: boolean;
  backgroundImagePath: string;
  glassOpacity: number;
  glassBlur: number;
  setUseImageBackground: (value: boolean) => void;
  setBackgroundImagePath: (path: string) => void;
  setGlassOpacity: (value: number) => void;
  setGlassBlur: (value: number) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const themes: Record<string, Theme> = {
  light: lightTheme,
  'dark-red': darkRedTheme,
  'blue-ocean': blueOceanTheme,
  'dark-blue': darkBlueTheme,
  'dark-orange': darkOrangeTheme,
  'dark-green': darkGreenTheme,
  'purple-pink': purplePinkTheme,
  'dark-gray': darkGrayTheme,
  'pink': pinkTheme,
  'sunny-yellow': sunnyYellowTheme,
  'mint-glass': mintGlassTheme,
  'paper-sepia': paperSepiaTheme,
  'nord-soft': nordSoftTheme,
  'graphite-light': graphiteLightTheme,
  'amoled-night': amoledNightTheme,
  'catppuccin-mocha': catppuccinMochaTheme,
  'everforest': everforestTheme,
  'tokyo-night': tokyoNightTheme,
  'warm-amber': warmAmberTheme,
};

// Convert hex color to RGB values
const hexToRgb = (hex: string): string => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
  }
  return '13, 27, 42'; // fallback dark blue
};

// Background images mapping for themes (animated gradients)
const themeBackgrounds: Record<string, string> = {
  'light': 'linear-gradient(-45deg, #e8f4f8, #d1e8e2, #c8e6c9, #b2dfdb, #e3f2fd)',
  'dark-red': 'linear-gradient(-45deg, #1a0a0a, #2d1515, #3d1a1a, #2d1010, #1a0505)',
  'blue-ocean': 'linear-gradient(-45deg, #0a1628, #1a3a5c, #0d3251, #153d5e, #0d2137)',
  'dark-blue': 'linear-gradient(-45deg, #0d1b2a, #1b3a4b, #0f2840, #1a4560, #0a1520)',
  'dark-orange': 'linear-gradient(-45deg, #1a1008, #2d1f0a, #3d2a0f, #2d1a05, #1a0f05)',
  'dark-green': 'linear-gradient(-45deg, #0a1a0a, #152d15, #0d3d0d, #1a4d1a, #051a05)',
  'purple-pink': 'linear-gradient(-45deg, #1a0a1a, #2d152d, #3d1a3d, #2d1040, #1a051a)',
  'dark-gray': 'linear-gradient(-45deg, #151515, #252525, #1a1a1a, #2a2a2a, #101010)',
  'pink': 'linear-gradient(-45deg, #2a1520, #3d2530, #4a2a3a, #3d2035, #2a1520)',
  'sunny-yellow': 'linear-gradient(-45deg, #fff8d1, #ffefb5, #ffe694, #fff3bf, #ffe082)',
  'mint-glass': 'linear-gradient(-45deg, #e8fff7, #d9f7ee, #cff3ea, #dcfbf2, #c8efe2)',
  'paper-sepia': 'linear-gradient(-45deg, #f8f1e1, #efe5cc, #f5ebd6, #e9dcc0, #f3e8d0)',
  'nord-soft': 'linear-gradient(-45deg, #2b313c, #323a47, #2f3644, #3a4354, #252b35)',
  'graphite-light': 'linear-gradient(-45deg, #f1f3f6, #e9edf2, #f5f6f8, #e3e7ed, #eef1f5)',
  'amoled-night': 'linear-gradient(-45deg, #050505, #0b0b0b, #121212, #090909, #020202)',
  'catppuccin-mocha': 'linear-gradient(-45deg, #181825, #1e1e2e, #28243d, #1f1d2e, #14141f)',
  'everforest': 'linear-gradient(-45deg, #1a2124, #232a2e, #2d383b, #222e2b, #192022)',
  'tokyo-night': 'linear-gradient(-45deg, #13141f, #1a1b26, #22273e, #1c1d30, #11121c)',
  'warm-amber': 'linear-gradient(-45deg, #1a1715, #24201e, #2e2824, #28211d, #171412)',
};

// Check if theme is light
const isLightTheme = (name: string): boolean => (
  name === 'light'
  || name === 'sunny-yellow'
  || name === 'mint-glass'
  || name === 'paper-sepia'
  || name === 'graphite-light'
);

const canLoadImage = (url: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
};

const resolveBackgroundImageUrl = async (filePath: string): Promise<string | null> => {
  const normalizedPath = filePath.replace(/\\/g, '/');

  const candidates = [
    convertFileSrc(filePath),
    convertFileSrc(normalizedPath),
    encodeURI(convertFileSrc(normalizedPath)),
  ];

  for (const url of candidates) {
    try {
      const ok = await canLoadImage(url);
      if (ok) {
        return url;
      }
    } catch {
      // Continue trying fallback URLs
    }
  }

  return null;
};

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { settings, updateSettings } = useSettings();

  const themeName = settings.theme || 'light';
  const baseTheme = themes[themeName] || themes.light;
  const modifiedTheme = settings.modifiedTheme;
  const useImageBackground = settings.use_background_image;
  const backgroundImagePath = settings.background_image_path;
  const glassOpacity = settings.glassOpacity;
  const glassBlur = settings.glassBlur;

  useEffect(() => {
    let cancelled = false;

    // Apply theme colors to CSS variables
    const root = document.documentElement;
    Object.entries(baseTheme.colors).forEach(([key, value]) => {
      let cssValue = value;
      if (modifiedTheme && (key === 'success' || key === 'warning' || key === 'error')) {
        cssValue = baseTheme.colors.primary;
      }
      root.style.setProperty(`--color-${key}`, cssValue);
    });

    // Set RGB variables for glassmorphism
    root.style.setProperty('--theme-bg-rgb', hexToRgb(baseTheme.colors.background));
    root.style.setProperty('--primary-rgb', hexToRgb(baseTheme.colors.primary));
    root.style.setProperty('--secondary-rgb', hexToRgb(baseTheme.colors.secondary));
    root.style.setProperty('--surface-rgb', hexToRgb(baseTheme.colors.surface));

    // Set light/dark theme specific variables
    const isLight = isLightTheme(themeName);
    root.style.setProperty('--bg-brightness', isLight ? '1.0' : '0.7');
    root.style.setProperty('--bg-overlay-opacity', useImageBackground ? '0.05' : (isLight ? '0.3' : '0.4'));

    // UI Glass variables
    root.style.setProperty('--glass-opacity', isLight ? '0.25' : '0.15');
    root.style.setProperty('--glass-border-color', isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.1)');
    root.style.setProperty('--glass-blur', '12px');
    root.style.setProperty('--glass-opacity-light', isLight ? '0.15' : '0.08');
    root.style.setProperty('--glass-blur-light', '8px');

    // Background Image variables based on user sliders
    const imgBrightness = Math.max(0, 100 - glassOpacity);
    root.style.setProperty('--bg-image-brightness', `${imgBrightness}%`);
    root.style.setProperty('--bg-image-blur', `${glassBlur}px`);
    const scale = 1 + (glassBlur * 0.003);
    root.style.setProperty('--bg-image-scale', `${scale}`);

    // Set background for the app-background element
    const bgElement = document.querySelector('.app-background') as HTMLElement;
    const applyThemeGradient = () => {
      if (!bgElement) return;
      bgElement.classList.remove('has-image-background');
      const bgStyle = themeBackgrounds[themeName] || themeBackgrounds['dark-blue'];
      bgElement.style.backgroundImage = '';
      bgElement.style.background = bgStyle;
      bgElement.style.backgroundSize = '200% 200%';
      bgElement.style.backgroundPosition = 'center';
      bgElement.style.backgroundRepeat = 'repeat';
      bgElement.style.backgroundColor = '';
      bgElement.style.animation = 'gradientShift 15s ease infinite';
    };

    const applyImageBackground = async () => {
      if (!bgElement) return;

      const fileUrl = await resolveBackgroundImageUrl(backgroundImagePath);
      if (!fileUrl || cancelled) {
        console.warn('[ThemeContext] Background image failed to load:', backgroundImagePath);
        applyThemeGradient();
        return;
      }

      bgElement.classList.add('has-image-background');
      bgElement.style.background = `transparent url("${fileUrl}") center / cover no-repeat`;
      bgElement.style.backgroundImage = `url("${fileUrl}")`;
      bgElement.style.backgroundSize = 'cover';
      bgElement.style.backgroundPosition = 'center';
      bgElement.style.backgroundRepeat = 'no-repeat';
      bgElement.style.backgroundColor = 'transparent';
      bgElement.style.animation = 'none';
    };

    if (bgElement) {
      if (useImageBackground && backgroundImagePath) {
        applyImageBackground();
      } else {
        applyThemeGradient();
      }
    }

    return () => {
      cancelled = true;
    };
  }, [baseTheme, themeName, modifiedTheme, useImageBackground, backgroundImagePath, glassOpacity, glassBlur]);

  const setTheme = (name: string) => {
    if (themes[name]) {
      updateSettings({ theme: name }, true);
    }
  };

  const setModifiedTheme = (value: boolean) => {
    updateSettings({ modifiedTheme: value }, true);
  };

  const setUseImageBackground = (value: boolean) => {
    updateSettings({ use_background_image: value }, true);
  };

  const setBackgroundImagePath = (path: string) => {
    updateSettings({ background_image_path: path }, true);
  };

  const setGlassOpacity = (value: number) => {
    updateSettings({ glassOpacity: value });
  };

  const setGlassBlur = (value: number) => {
    updateSettings({ glassBlur: value });
  };

  const effectiveTheme = modifiedTheme
    ? {
        ...baseTheme,
        colors: {
          ...baseTheme.colors,
          success: baseTheme.colors.primary,
          warning: baseTheme.colors.primary,
          error: baseTheme.colors.primary,
        },
      }
    : baseTheme;

  return (
    <ThemeContext.Provider
      value={{
        theme: effectiveTheme,
        themeName,
        modifiedTheme,
        setTheme,
        setModifiedTheme,
        useImageBackground,
        backgroundImagePath,
        setUseImageBackground,
        setBackgroundImagePath,
        glassOpacity,
        setGlassOpacity,
        glassBlur,
        setGlassBlur,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};

export default ThemeContext;
