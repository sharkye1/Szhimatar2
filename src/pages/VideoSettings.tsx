import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import '../styles/SettingsWindow.css';

interface VideoSettingsProps {
  onBack: () => void;
}

const VideoSettings: React.FC<VideoSettingsProps> = ({ onBack }) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  
  const [codec, setCodec] = useState('h264');
  const [bitrate, setBitrate] = useState('5');
  const [fps, setFps] = useState('30');
  const [resolution, setResolution] = useState('1920x1080');
  const [crf, setCrf] = useState('23');
  const [preset, setPreset] = useState('medium');

  return (
    <div className="settings-window fade-in" style={{ background: theme.colors.background, color: theme.colors.text }}>
      <header className="settings-header" style={{ background: theme.colors.surface, borderColor: theme.colors.border }}>
        <button onClick={onBack} className="back-button" style={{ color: theme.colors.primary }}>
          ← {t('buttons.back')}
        </button>
        <h1>{t('video.title')}</h1>
      </header>
      
      <div className="settings-content">
        <div className="setting-group">
          <label>{t('video.codec')}</label>
          <select value={codec} onChange={(e) => setCodec(e.target.value)} 
                  style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}>
            <option value="h264">H.264 (x264)</option>
            <option value="h265">H.265 (x265/HEVC)</option>
            <option value="vp9">VP9</option>
            <option value="av1">AV1</option>
          </select>
        </div>

        <div className="setting-group">
          <label>{t('video.bitrate')}</label>
          <input type="number" value={bitrate} onChange={(e) => setBitrate(e.target.value)} 
                 style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
                 min="1" max="50" step="0.5" />
        </div>

        <div className="setting-group">
          <label>{t('video.fps')}</label>
          <select value={fps} onChange={(e) => setFps(e.target.value)}
                  style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}>
            <option value="24">24</option>
            <option value="30">30</option>
            <option value="60">60</option>
            <option value="120">120</option>
          </select>
        </div>

        <div className="setting-group">
          <label>{t('video.resolution')}</label>
          <select value={resolution} onChange={(e) => setResolution(e.target.value)}
                  style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}>
            <option value="original">Original</option>
            <option value="3840x2160">4K (3840x2160)</option>
            <option value="2560x1440">2K (2560x1440)</option>
            <option value="1920x1080">Full HD (1920x1080)</option>
            <option value="1280x720">HD (1280x720)</option>
            <option value="854x480">SD (854x480)</option>
          </select>
        </div>

        <div className="setting-group">
          <label>{t('video.crf')} (0-51)</label>
          <input type="range" value={crf} onChange={(e) => setCrf(e.target.value)} 
                 min="0" max="51" />
          <span style={{ color: theme.colors.textSecondary }}>{crf}</span>
        </div>

        <div className="setting-group">
          <label>{t('video.preset')}</label>
          <select value={preset} onChange={(e) => setPreset(e.target.value)}
                  style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}>
            <option value="ultrafast">Ultrafast</option>
            <option value="superfast">Superfast</option>
            <option value="veryfast">Veryfast</option>
            <option value="faster">Faster</option>
            <option value="fast">Fast</option>
            <option value="medium">Medium</option>
            <option value="slow">Slow</option>
            <option value="slower">Slower</option>
            <option value="veryslow">Veryslow</option>
          </select>
        </div>
      </div>

      <div className="settings-footer" style={{ borderColor: theme.colors.border }}>
        <button style={{ background: theme.colors.primary, color: '#fff' }}>
          {t('buttons.apply')}
        </button>
        <button style={{ background: theme.colors.secondary, color: '#fff' }}>
          {t('buttons.reset')}
        </button>
      </div>
    </div>
  );
};

export default VideoSettings;
