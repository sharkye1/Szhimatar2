import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { AudioSettings as AudioSettingsType } from '../types/index';
import '../styles/AudioSettings.css';

interface AudioSettingsProps {
  onBack: () => void;
  settings: AudioSettingsType;
  setSettings: React.Dispatch<React.SetStateAction<AudioSettingsType>>;
}

const AudioSettings: React.FC<AudioSettingsProps> = ({ onBack, settings, setSettings }) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const [expandedSection, setExpandedSection] = useState<'noise' | 'effects' | null>(null);

  // Codec presets with compatibility info
  const codecs = [
    { label: t('audioSettings.codecs.aac'), value: 'aac', supportsEffects: true },
    { label: t('audioSettings.codecs.mp3'), value: 'mp3', supportsEffects: true },
    { label: t('audioSettings.codecs.opus'), value: 'opus', supportsEffects: true },
    { label: t('audioSettings.codecs.vorbis'), value: 'vorbis', supportsEffects: true },
    { label: t('audioSettings.codecs.flac'), value: 'flac', supportsEffects: true },
    { label: t('audioSettings.codecs.copy'), value: 'copy', supportsEffects: false },
  ];

  const bitrates = [
    { label: '64', value: '64' },
    { label: '96', value: '96' },
    { label: '128', value: '128' },
    { label: '192', value: '192' },
    { label: '256', value: '256' },
    { label: '320', value: '320' },
    { label: '384', value: '384' },
    { label: '448', value: '448' },
    { label: '512', value: '512' },
  ];

  const sampleRates = [
    { label: '22050 Hz', value: '22050' },
    { label: '44100 Hz', value: '44100' },
    { label: '48000 Hz', value: '48000' },
    { label: '96000 Hz', value: '96000' },
    { label: '192000 Hz', value: '192000' },
  ];

  const channelOptions = [
    { label: t('audioSettings.channels.mono'), value: '1' },
    { label: t('audioSettings.channels.stereo'), value: '2' },
    { label: '5.1', value: '6' },
    { label: '7.1', value: '8' },
  ];

  const canUseEffects = () => {
    const codec = codecs.find(c => c.value === settings.codec);
    return codec?.supportsEffects ?? true;
  };

  const handleEffectToggle = (effectName: string) => {
    if (!canUseEffects()) return;
    setSettings(prev => ({
      ...prev,
      effects: prev.effects.map(e =>
        e.name === effectName ? { ...e, enabled: !e.enabled } : e
      )
    }));
  };

  const handleEqualizerChange = (frequency: number, newGain: number) => {
    setSettings(prev => ({
      ...prev,
      equalizer: prev.equalizer.map(band =>
        band.frequency === frequency ? { ...band, gain: newGain } : band
      )
    }));
  };

  const resetEqualizer = () => {
    setSettings(prev => ({
      ...prev,
      equalizer: prev.equalizer.map(band => ({ ...band, gain: 0 }))
    }));
  };

  const getPitchLabel = (pitch: number): string => {
    if (pitch === 0) return t('audioSettings.pitchLabel.normal');
    const direction = pitch > 0 ? t('audioSettings.pitchLabel.higher') : t('audioSettings.pitchLabel.lower');
    return `${Math.abs(pitch)} ${t('audioSettings.pitchLabel.semitones')} ${direction}`;
  };

  return (
    <div className="settings-window fade-in" style={{ background: theme.colors.background, color: theme.colors.text }}>
      <header className="settings-header" style={{ background: theme.colors.surface, borderColor: theme.colors.border }}>
        <button onClick={onBack} className="back-button" style={{ color: theme.colors.primary }}>
          ← {t('buttons.back')}
        </button>
        <h1>{t('audio.title')}</h1>
      </header>

      <div className="settings-content audio-settings-extended">
        {/* Auto-Select */}
        <div className="setting-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.autoSelect}
              onChange={(e) => setSettings({ ...settings, autoSelect: e.target.checked })}
            />
            <span>{t('audioSettings.autoSelect')}</span>
          </label>
          <div className="setting-hint">{t('audioSettings.autoSelectHint')}</div>
        </div>

        {/* Basic Settings Row 1 */}
        <div className="setting-row">
          <div className="setting-group flex-1">
            <label>{t('audio.codec')}</label>
            <select
              value={settings.codec}
              onChange={(e) => setSettings({ ...settings, codec: e.target.value })}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
            >
              {codecs.map(codec => (
                <option key={codec.value} value={codec.value}>{codec.label}</option>
              ))}
            </select>
          </div>

          <div className="setting-group flex-1">
            <label>{t('audio.bitrate')}</label>
            <select
              value={settings.bitrate}
              onChange={(e) => setSettings({ ...settings, bitrate: e.target.value })}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
              disabled={settings.codec === 'copy'}
            >
              {bitrates.map(br => (
                <option key={br.value} value={br.value}>{br.label} {t('audioSettings.bitrateUnit')}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Basic Settings Row 2 */}
        <div className="setting-row">
          <div className="setting-group flex-1">
            <label>{t('audio.channels')}</label>
            <select
              value={settings.channels}
              onChange={(e) => setSettings({ ...settings, channels: e.target.value })}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
              disabled={settings.codec === 'copy'}
            >
              {channelOptions.map(ch => (
                <option key={ch.value} value={ch.value}>{ch.label}</option>
              ))}
            </select>
          </div>

          <div className="setting-group flex-1">
            <label>{t('audio.sampleRate')}</label>
            <select
              value={settings.sampleRate}
              onChange={(e) => setSettings({ ...settings, sampleRate: e.target.value })}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
              disabled={settings.codec === 'copy'}
            >
              {sampleRates.map(sr => (
                <option key={sr.value} value={sr.value}>{sr.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Volume & Gain */}
        <div className="setting-row">
          <div className="setting-group flex-1">
            <label>{t('audioSettings.volume')}</label>
            <div className="slider-with-label">
              <input
                type="range"
                value={settings.volume}
                onChange={(e) => setSettings({ ...settings, volume: e.target.value })}
                min="0"
                max="200"
                step="1"
                style={{ flex: 1 }}
              />
              <span style={{ marginLeft: '12px', minWidth: '60px', color: theme.colors.textSecondary }}>
                {settings.volume}%
              </span>
            </div>
          </div>

          <div className="setting-group flex-1">
            <label>{t('audioSettings.gain')}</label>
            <div className="slider-with-label">
              <input
                type="range"
                value={settings.gain}
                onChange={(e) => setSettings({ ...settings, gain: e.target.value })}
                min="-20"
                max="20"
                step="1"
                style={{ flex: 1 }}
              />
              <span style={{ marginLeft: '12px', minWidth: '60px', color: theme.colors.textSecondary }}>
                {settings.gain} dB
              </span>
            </div>
          </div>
        </div>

        {/* Normalization & Pitch */}
        <div className="setting-row">
          <div className="setting-group flex-1">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.normalization}
                onChange={(e) => setSettings({ ...settings, normalization: e.target.checked })}
                disabled={settings.codec === 'copy'}
              />
              <span>{t('audioSettings.normalization')}</span>
            </label>
            <div className="setting-hint">{t('audioSettings.normalizationHint')}</div>
          </div>

          <div className="setting-group flex-1">
            <label>{t('audioSettings.pitch')}</label>
            <div className="slider-with-label">
              <input
                type="range"
                value={settings.pitch}
                onChange={(e) => setSettings({ ...settings, pitch: parseInt(e.target.value) })}
                min="-12"
                max="12"
                step="1"
                style={{ flex: 1 }}
              />
              <span style={{ marginLeft: '12px', minWidth: '140px', color: theme.colors.textSecondary }}>
                {getPitchLabel(settings.pitch)}
              </span>
            </div>
          </div>
        </div>

        {/* Noise Reduction */}
        <div className="setting-group">
          <div className="setting-label-with-help">
            <label>{t('audioSettings.noiseReduction')}</label>
            <button
              className="help-btn"
              onClick={() => setExpandedSection(expandedSection === 'noise' ? null : 'noise')}
              style={{ color: theme.colors.primary }}
            >
              ℹ️
            </button>
          </div>
          <div className="slider-with-label">
            <input
              type="range"
              value={settings.noiseReduction}
              onChange={(e) => setSettings({ ...settings, noiseReduction: e.target.value })}
              min="0"
              max="1"
              step="0.1"
              style={{ flex: 1 }}
            />
            <span style={{ marginLeft: '12px', minWidth: '60px', color: theme.colors.textSecondary }}>
              {(parseFloat(settings.noiseReduction) * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        {expandedSection === 'noise' && (
          <div className="help-section" style={{ background: theme.colors.surface, borderColor: theme.colors.border }}>
            <p>{t('audioSettings.noiseReductionHint')}</p>
          </div>
        )}

        {/* 5-Band Equalizer */}
        <div className="equalizer-section">
          <div className="equalizer-header">
            <h3>{t('audioSettings.equalizer')}</h3>
            <button
              onClick={resetEqualizer}
              className="btn-reset-eq"
              style={{ color: theme.colors.primary, fontSize: '12px' }}
            >
              {t('audioSettings.resetEQ')}
            </button>
          </div>
          <div className="equalizer-grid">
            {settings.equalizer.map(band => (
              <div key={band.frequency} className="eq-band">
                <div className="eq-label">{band.frequency} Hz</div>
                <input
                  type="range"
                  value={band.gain}
                  onChange={(e) => handleEqualizerChange(band.frequency, parseInt(e.target.value))}
                  min="-12"
                  max="12"
                  step="1"
                  className="eq-slider"
                />
                <div className="eq-value">{band.gain > 0 ? '+' : ''}{band.gain} dB</div>
              </div>
            ))}
          </div>
        </div>

        {/* Effects */}
        <div className="effects-section">
          <div className="effects-header">
            <h3>{t('audioSettings.effects')}</h3>
            {!canUseEffects() && (
              <span className="effects-disabled-notice">{t('audioSettings.effectsDisabledNotice')}</span>
            )}
          </div>
          <div className="effects-grid">
            {settings.effects.map(effect => (
              <label
                key={effect.name}
                className="effect-checkbox"
                style={{
                  opacity: canUseEffects() ? 1 : 0.5,
                  pointerEvents: canUseEffects() ? 'auto' : 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={effect.enabled}
                  onChange={() => handleEffectToggle(effect.name)}
                  disabled={!canUseEffects()}
                />
                <span>{t(`audioSettings.effectNames.${effect.name}`)}</span>
              </label>
            ))}
          </div>
          {expandedSection === 'effects' && (
            <div className="help-section" style={{ background: theme.colors.surface, borderColor: theme.colors.border, marginTop: '12px' }}>
              <p>{t('audioSettings.effectsHint')}</p>
            </div>
          )}
        </div>
      </div>

      <div className="settings-footer" style={{ borderColor: theme.colors.border }}>
        <button onClick={onBack} style={{ background: theme.colors.secondary, color: '#fff' }}>
          {t('buttons.close')}
        </button>
      </div>
    </div>
  );
};

export default AudioSettings;
