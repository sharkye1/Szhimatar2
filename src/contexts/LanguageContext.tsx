import React, { createContext, useContext, ReactNode } from 'react';
import { useSettings } from './SettingsContext';
import ruTranslations from '../lang/ru.json';
import enTranslations from '../lang/en.json';
import chTranslations from '../lang/ch.json';
import eoTranslations from '../lang/eo.json';
import myTranslations from '../lang/my.json';
import vzTranslations from '../lang/vz.json';
import empTranslations from '../lang/emp.json';

type Translations = typeof ruTranslations;
type TranslationBundle = Omit<Translations, 'recentVideos'> & Partial<Pick<Translations, 'recentVideos'>>;

interface LanguageContextType {
  language: string;
  isEmp: boolean;
  translations: Translations;
  setLanguage: (lang: string) => void;
  t: (path: string, fallback?: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const languages: Record<string, TranslationBundle> = {
  ru: ruTranslations,
  en: enTranslations,
  ch: chTranslations,
  eo: eoTranslations,
  my: myTranslations,
  vz: vzTranslations,
  emp: empTranslations,
};

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { settings, updateSettings } = useSettings();
  const language = settings.language || 'ru';
  const isEmp = language === 'emp';
  const selected = languages[language] || ruTranslations;
  const translations: Translations = {
    ...selected,
    recentVideos: selected.recentVideos ?? enTranslations.recentVideos,
  };

  const setLanguage = (lang: string) => {
    if (languages[lang]) {
      updateSettings({ language: lang }, true);
    }
  };

  const t = (path: string, fallback?: string): string => {
    if (isEmp) {
      return '';
    }
    const keys = path.split('.');
    let value: any = translations;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return fallback !== undefined ? fallback : path;
      }
    }

    if (typeof value === 'string') {
      return value;
    }
    return fallback !== undefined ? fallback : path;
  };

  return (
    <LanguageContext.Provider value={{ language, isEmp, translations, setLanguage, t }}>
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

export default LanguageContext;
