import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { FfmpegManager } from '../components/FfmpegManager';
import { APP_VERSION } from '../version';
import '../styles/SettingsWindow.css';

interface GeneralSettingsProps {
  onBack: () => void;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = ({ onBack }) => {
  const { t, setLanguage: setAppLanguage } = useLanguage();
  const { theme, setTheme: setAppTheme } = useTheme();
  
  const [themeName, setThemeName] = useState('light');
  const [language, setLanguage] = useState('ru');
  const [outputSuffix, setOutputSuffix] = useState('_szhatoe');
  const [showFfmpegManager, setShowFfmpegManager] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await invoke<any>('load_settings');
      setThemeName(settings.theme);
      setLanguage(settings.language);
      setOutputSuffix(settings.output_suffix);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const saveSettings = async () => {
    try {
      const settings = await invoke<any>('load_settings');
      await invoke('save_settings', {
        settings: {
          ...settings,
          theme: themeName,
          language,
          output_suffix: outputSuffix,
        }
      });
      
      setAppTheme(themeName);
      setAppLanguage(language);
      
      await invoke('write_log', { message: 'Settings saved' });
      alert('Settings saved!');
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('Failed to save settings');
    }
  };

  return (
    <div className="settings-window fade-in" style={{ background: theme.colors.background, color: theme.colors.text }}>
      <header className="settings-header" style={{ background: theme.colors.surface, borderColor: theme.colors.border }}>
        <button onClick={onBack} className="back-button" style={{ color: theme.colors.primary }}>
          ← {t('buttons.back')}
        </button>
        <h1>{t('settings.title')}</h1>
      </header>
      
      <div className="settings-content">
        <div className="setting-group">
          <label>{t('settings.theme')}</label>
          <select value={themeName} onChange={(e) => setThemeName(e.target.value)}
                  style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}>
            <option value="light">Light</option>
            <option value="dark-red">Dark Red</option>
            <option value="blue-ocean">Blue Ocean</option>
            <option value="dark-blue">Dark Blue</option>
          </select>
        </div>

        <div className="setting-group">
          <label>{t('settings.language')}</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}
                  style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}>
            <option value="ru">Русский</option>
            <option value="en">English</option>
            <option value="ch">中文</option>
            <option value="eo">Esperanto</option>
            <option value="my">Medžuslovjansky</option>
          </select>
        </div>

        <div className="setting-group">
          <label>{t('settings.outputSuffix')}</label>
          <input type="text" value={outputSuffix} onChange={(e) => setOutputSuffix(e.target.value)}
                 style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
                 placeholder="_szhatoe" />
        </div>

        <div className="setting-group">
          <label>{t('ffmpeg.configurationLabel')}</label>
          <button 
            onClick={() => setShowFfmpegManager(!showFfmpegManager)}
            style={{ background: theme.colors.primary, color: '#fff', padding: '8px 16px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            {showFfmpegManager ? t('ffmpeg.toggleHide') : t('ffmpeg.toggleConfigure')}
          </button>
        </div>

        {showFfmpegManager && (
          <div className="setting-group" style={{ marginTop: '20px' }}>
            <FfmpegManager />
          </div>
        )}

        <div className="setting-group">
          <label>{t('app.version')}</label>
          <div style={{ color: theme.colors.textSecondary }}>v{APP_VERSION}</div>
        </div>

      <div className="settings-footer" style={{ borderColor: theme.colors.border }}>
        <button onClick={saveSettings} style={{ background: theme.colors.success, color: '#fff' }}>
          {t('settings.save')}
        </button>
        <button onClick={loadSettings} style={{ background: theme.colors.secondary, color: '#fff' }}>
          {t('settings.cancel')}
        </button>
      </div>
    </div>
    </div>
);
    
};
export default GeneralSettings;