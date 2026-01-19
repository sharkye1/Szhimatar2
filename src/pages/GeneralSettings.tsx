import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import '../styles/SettingsWindow.css';

interface GeneralSettingsProps {
  onBack: () => void;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = ({ onBack }) => {
  const { t, setLanguage: setAppLanguage } = useLanguage();
  const { theme, setTheme: setAppTheme } = useTheme();
  
  const [themeName, setThemeName] = useState('light');
  const [language, setLanguage] = useState('ru');
  const [ffmpegPath, setFfmpegPath] = useState('ffmpeg');
  const [ffprobePath, setFfprobePath] = useState('ffprobe');
  const [outputSuffix, setOutputSuffix] = useState('_szhatoe');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await invoke<any>('load_settings');
      setThemeName(settings.theme);
      setLanguage(settings.language);
      setFfmpegPath(settings.ffmpeg_path);
      setFfprobePath(settings.ffprobe_path);
      setOutputSuffix(settings.output_suffix);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const saveSettings = async () => {
    try {
      await invoke('save_settings', {
        settings: {
          theme: themeName,
          language,
          ffmpeg_path: ffmpegPath,
          ffprobe_path: ffprobePath,
          output_suffix: outputSuffix,
          default_video_codec: 'h264',
          default_audio_codec: 'aac'
        }
      });
      
      setAppTheme(themeName);
      setAppLanguage(language);
      
      await invoke('write_log', { message: 'Settings saved' });
      alert('Settings saved! Restart may be required.');
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
          </select>
        </div>

        <div className="setting-group">
          <label>{t('settings.language')}</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}
                  style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </div>

        <div className="setting-group">
          <label>{t('settings.ffmpegPath')}</label>
          <input type="text" value={ffmpegPath} onChange={(e) => setFfmpegPath(e.target.value)}
                 style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
                 placeholder="ffmpeg" />
        </div>

        <div className="setting-group">
          <label>{t('settings.ffprobePath')}</label>
          <input type="text" value={ffprobePath} onChange={(e) => setFfprobePath(e.target.value)}
                 style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
                 placeholder="ffprobe" />
        </div>

        <div className="setting-group">
          <label>{t('settings.outputSuffix')}</label>
          <input type="text" value={outputSuffix} onChange={(e) => setOutputSuffix(e.target.value)}
                 style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
                 placeholder="_szhatoe" />
        </div>

        <div className="setting-group">
          <label>{t('app.version')}</label>
          <div style={{ color: theme.colors.textSecondary }}>0.1.0</div>
        </div>
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
  );
};

export default GeneralSettings;
