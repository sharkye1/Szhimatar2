import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import lightTheme from '../themes/light.json';
import darkRedTheme from '../themes/dark-red.json';
import blueOceanTheme from '../themes/blue-ocean.json';
import darkBlueTheme from '../themes/dark-blue.json';
import darkOrangeTheme from '../themes/dark-orange.json';
import darkGreenTheme from '../themes/dark-green.json';
import purplePinkTheme from '../themes/purple-pink.json';
import darkGrayTheme from '../themes/dark-gray.json';
import pinkTheme from '../themes/pink.json';

interface Theme {
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
  setTheme: (name: string) => void;
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
};

// Check if theme is light
const isLightTheme = (name: string): boolean => name === 'light';

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [themeName, setThemeName] = useState<string>('light');
  const [theme, setThemeState] = useState<Theme>(themes.light);

  useEffect(() => {
    // Load theme from settings
    const loadTheme = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        const settings = await invoke<any>('load_settings');
        if (settings.theme && themes[settings.theme]) {
          setThemeName(settings.theme);
          setThemeState(themes[settings.theme]);
        }
      } catch (error) {
        console.error('Failed to load theme:', error);
      }
    };
    loadTheme();
  }, []);

  useEffect(() => {
    // Apply theme colors to CSS variables
    const root = document.documentElement;
    Object.entries(theme.colors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${key}`, value);
    });
    
    // Set RGB variables for glassmorphism
    root.style.setProperty('--theme-bg-rgb', hexToRgb(theme.colors.background));
    root.style.setProperty('--primary-rgb', hexToRgb(theme.colors.primary));
    root.style.setProperty('--secondary-rgb', hexToRgb(theme.colors.secondary));
    root.style.setProperty('--surface-rgb', hexToRgb(theme.colors.surface));
    
    // Set light/dark theme specific variables
    const isLight = isLightTheme(themeName);
    root.style.setProperty('--bg-brightness', isLight ? '1.0' : '0.7');
    root.style.setProperty('--bg-overlay-opacity', isLight ? '0.3' : '0.4');
    root.style.setProperty('--glass-opacity', isLight ? '0.25' : '0.15');
    root.style.setProperty('--glass-border-color', isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.1)');
    
    // Set background for the app-background element
    const bgElement = document.querySelector('.app-background') as HTMLElement;
    if (bgElement) {
      const bgStyle = themeBackgrounds[themeName] || themeBackgrounds['dark-blue'];
      bgElement.style.background = bgStyle;
    }
  }, [theme, themeName]);

  const setTheme = (name: string) => {
    if (themes[name]) {
      setThemeName(name);
      setThemeState(themes[name]);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, themeName, setTheme }}>
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
