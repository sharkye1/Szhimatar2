import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import lightTheme from '../themes/light.json';
import darkRedTheme from '../themes/dark-red.json';
import blueOceanTheme from '../themes/blue-ocean.json';
import darkBlueTheme from '../themes/dark-blue.json';

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
};

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
  }, [theme]);

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
