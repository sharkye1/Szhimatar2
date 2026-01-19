import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import '../styles/SettingsWindow.css';

interface AudioSettingsProps {
  onBack: () => void;
}

const AudioSettings: React.FC<AudioSettingsProps> = ({ onBack }) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  
  const [codec, setCodec] = useState('aac');
  const [bitrate, setBitrate] = useState('192');
  const [channels, setChannels] = useState('2');
  const [sampleRate, setSampleRate] = useState('48000');
  const [volume, setVolume] = useState('100');

  return (
    <div className="settings-window fade-in" style={{ background: theme.colors.background, color: theme.colors.text }}>
      <header className="settings-header" style={{ background: theme.colors.surface, borderColor: theme.colors.border }}>
        <button onClick={onBack} className="back-button" style={{ color: theme.colors.primary }}>
          ← {t('buttons.back')}
        </button>
        <h1>{t('audio.title')}</h1>
      </header>
      
      <div className="settings-content">
        <div className="setting-group">
          <label>{t('audio.codec')}</label>
          <select value={codec} onChange={(e) => setCodec(e.target.value)}
                  style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}>
            <option value="aac">AAC</option>
            <option value="mp3">MP3</option>
            <option value="opus">Opus</option>
            <option value="vorbis">Vorbis</option>
            <option value="flac">FLAC</option>
          </select>
        </div>

        <div className="setting-group">
          <label>{t('audio.bitrate')}</label>
          <select value={bitrate} onChange={(e) => setBitrate(e.target.value)}
                  style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}>
            <option value="64">64 kbps</option>
            <option value="96">96 kbps</option>
            <option value="128">128 kbps</option>
            <option value="192">192 kbps</option>
            <option value="256">256 kbps</option>
            <option value="320">320 kbps</option>
          </select>
        </div>

        <div className="setting-group">
          <label>{t('audio.channels')}</label>
          <select value={channels} onChange={(e) => setChannels(e.target.value)}
                  style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}>
            <option value="1">Mono</option>
            <option value="2">Stereo</option>
            <option value="6">5.1</option>
            <option value="8">7.1</option>
          </select>
        </div>

        <div className="setting-group">
          <label>{t('audio.sampleRate')}</label>
          <select value={sampleRate} onChange={(e) => setSampleRate(e.target.value)}
                  style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}>
            <option value="22050">22050 Hz</option>
            <option value="44100">44100 Hz</option>
            <option value="48000">48000 Hz</option>
            <option value="96000">96000 Hz</option>
          </select>
        </div>

        <div className="setting-group">
          <label>{t('audio.volume')} (%)</label>
          <input type="range" value={volume} onChange={(e) => setVolume(e.target.value)} 
                 min="0" max="200" />
          <span style={{ color: theme.colors.textSecondary }}>{volume}%</span>
        </div>

        <div className="setting-group">
          <label>{t('audio.equalizer')}</label>
          <div className="equalizer-placeholder" style={{ 
            background: theme.colors.surface, 
            color: theme.colors.textSecondary,
            borderColor: theme.colors.border,
            padding: '40px',
            textAlign: 'center',
            borderRadius: '8px',
            border: '1px solid'
          }}>
            Equalizer placeholder (coming soon)
          </div>
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

export default AudioSettings;
