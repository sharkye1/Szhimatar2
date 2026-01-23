import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { AudioSettings as AudioSettingsType } from '../types/index';
import { 
  getCodecOptions, 
  applyCodecConstraints,
  hasActiveFilters,
  validateAudioSettings
} from '../utils/audioValidation';
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
  const [warning, setWarning] = useState<string | null>(null);

  // Codec presets with compatibility info
  const codecs = [
    { label: t('audioSettings.codecs.aac'), value: 'aac', supportsEffects: true },
    { label: t('audioSettings.codecs.mp3'), value: 'mp3', supportsEffects: true },
    { label: t('audioSettings.codecs.opus'), value: 'opus', supportsEffects: true },
    { label: t('audioSettings.codecs.vorbis'), value: 'vorbis', supportsEffects: true },
    { label: t('audioSettings.codecs.flac'), value: 'flac', supportsEffects: true },
    { label: t('audioSettings.codecs.copy'), value: 'copy', supportsEffects: false },
  ];

  // Get dynamic options based on current codec
  const codecOptions = getCodecOptions(settings.codec);

  // Show warning and auto-hide after 5 seconds
  const showWarning = useCallback((message: string) => {
    setWarning(message);
    setTimeout(() => setWarning(null), 5000);
  }, []);

  // Handle codec change with auto-correction
  const handleCodecChange = useCallback((newCodec: string) => {
    const correctedSettings = applyCodecConstraints(settings, newCodec);
    const hasChanges = 
      correctedSettings.sampleRate !== settings.sampleRate ||
      correctedSettings.channels !== settings.channels ||
      correctedSettings.bitrate !== settings.bitrate ||
      (newCodec === 'copy' && hasActiveFilters(settings));
    
    if (hasChanges) {
      showWarning(t('audioValidation.warningAutoCorrected'));
    }
    
    setSettings(correctedSettings);
  }, [settings, setSettings, showWarning, t]);

  // Validate settings when codec changes
  useEffect(() => {
    const validation = validateAudioSettings(settings);
    if (!validation.isValid && Object.keys(validation.correctedSettings).length > 0) {
      // Auto-apply corrections
      setSettings(prev => ({ ...prev, ...validation.correctedSettings }));
      if (validation.warnings.length > 0) {
        showWarning(t('audioValidation.warningAutoCorrected'));
      }
    }
  }, [settings.codec]); // Only validate on codec change to avoid loops

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
        {/* Warning Banner */}
        {warning && (
          <div 
            className="audio-warning-banner"
            style={{ 
              background: theme.colors.warning + '20', 
              borderColor: theme.colors.warning,
              color: theme.colors.warning 
            }}
          >
            ⚠️ {warning}
          </div>
        )}

        {/* Codec Constraint Info */}
        {settings.codec !== 'copy' && settings.codec !== 'aac' && (
          <div 
            className="codec-info-banner"
            style={{ 
              background: theme.colors.primary + '15', 
              borderColor: theme.colors.primary,
              color: theme.colors.textSecondary 
            }}
          >
            ℹ️ {t(`audioValidation.codecInfo.${settings.codec}`) || t('audioValidation.codecInfoDefault')}
          </div>
        )}

        {/* Auto-Select */}
        <div className="setting-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.autoSelect}
              onChange={(e) => setSettings(prev => ({ ...prev, autoSelect: e.target.checked }))}
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
              onChange={(e) => handleCodecChange(e.target.value)}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
            >
              {codecs.map(codec => (
                <option key={codec.value} value={codec.value}>{codec.label}</option>
              ))}
            </select>
          </div>

          <div className="setting-group flex-1">
            <label>
              {t('audio.bitrate')}
              {codecOptions.bitrateDisabled && settings.codec !== 'copy' && (
                <span style={{ fontSize: '11px', color: theme.colors.textSecondary, marginLeft: '4px' }}>
                  ({t('audioValidation.notApplicable')})
                </span>
              )}
            </label>
            <select
              value={settings.bitrate}
              onChange={(e) => setSettings(prev => ({ ...prev, bitrate: e.target.value }))}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
              disabled={codecOptions.bitrateDisabled}
            >
              {codecOptions.bitrates.map(br => (
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
              onChange={(e) => setSettings(prev => ({ ...prev, channels: e.target.value }))}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
              disabled={codecOptions.channelsDisabled}
            >
              {codecOptions.channels.map(ch => (
                <option key={ch.value} value={ch.value}>
                  {ch.value === '1' ? t('audioSettings.channels.mono') : 
                   ch.value === '2' ? t('audioSettings.channels.stereo') : 
                   ch.label}
                </option>
              ))}
            </select>
          </div>

          <div className="setting-group flex-1">
            <label>
              {t('audio.sampleRate')}
              {codecOptions.sampleRateDisabled && settings.codec !== 'copy' && (
                <span style={{ fontSize: '11px', color: theme.colors.textSecondary, marginLeft: '4px' }}>
                  ({t('audioValidation.fixed')})
                </span>
              )}
            </label>
            <select
              value={settings.sampleRate}
              onChange={(e) => setSettings(prev => ({ ...prev, sampleRate: e.target.value }))}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
              disabled={codecOptions.sampleRateDisabled}
            >
              {codecOptions.sampleRates.map(sr => (
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
                onChange={(e) => setSettings(prev => ({ ...prev, volume: e.target.value }))}
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
                onChange={(e) => setSettings(prev => ({ ...prev, gain: e.target.value }))}
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
                onChange={(e) => setSettings(prev => ({ ...prev, normalization: e.target.checked }))}
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
                onChange={(e) => setSettings(prev => ({ ...prev, pitch: parseInt(e.target.value) }))}
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
              onChange={(e) => setSettings(prev => ({ ...prev, noiseReduction: e.target.value }))}
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
