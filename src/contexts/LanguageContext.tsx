import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import ruTranslations from '../lang/ru.json';
import enTranslations from '../lang/en.json';

type Translations = typeof ruTranslations;

interface LanguageContextType {
  language: string;
  translations: Translations;
  setLanguage: (lang: string) => void;
  t: (path: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const languages: Record<string, Translations> = {
  ru: ruTranslations,
  en: enTranslations,
};

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<string>('ru');
  const [translations, setTranslations] = useState<Translations>(languages.ru);

  useEffect(() => {
    // Load language from settings
    const loadLanguage = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        const settings = await invoke<any>('load_settings');
        if (settings.language && languages[settings.language]) {
          setLanguageState(settings.language);
          setTranslations(languages[settings.language]);
        }
      } catch (error) {
        console.error('Failed to load language:', error);
      }
    };
    loadLanguage();
  }, []);

  const setLanguage = (lang: string) => {
    if (languages[lang]) {
      setLanguageState(lang);
      setTranslations(languages[lang]);
    }
  };

  const t = (path: string): string => {
    const keys = path.split('.');
    let value: any = translations;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return path; // Return path if translation not found
      }
    }
    
    return typeof value === 'string' ? value : path;
  };

  return (
    <LanguageContext.Provider value={{ language, translations, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
};
