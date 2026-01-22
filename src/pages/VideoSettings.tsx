import React, { useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { VideoSettings as VideoSettingsType, WatermarkSettings as WatermarkSettingsType } from '../types/index';
import '../styles/VideoSettings.css';

interface VideoSettingsProps {
  onBack: () => void;
  settings: VideoSettingsType;
  setSettings: React.Dispatch<React.SetStateAction<VideoSettingsType>>;
  watermarkSettings: WatermarkSettingsType;
  setWatermarkSettings: React.Dispatch<React.SetStateAction<WatermarkSettingsType>>;
}

const VideoSettings: React.FC<VideoSettingsProps> = ({ 
  onBack, 
  settings, 
  setSettings,
  watermarkSettings,
  setWatermarkSettings
}) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const [expandedSection, setExpandedSection] = useState<'crf' | null>(null);

  // Resolution presets
  const resolutions = [
    { label: t('videoSettings.resolutionOptions.144pPotato'), value: '256x144' },
    { label: t('videoSettings.resolutionOptions.240pPotatoPlus'), value: '426x240' },
    { label: t('videoSettings.resolutionOptions.360pMobile'), value: '640x360' },
    { label: t('videoSettings.resolutionOptions.480pSD'), value: '854x480' },
    { label: t('videoSettings.resolutionOptions.720pHD'), value: '1280x720' },
    { label: t('videoSettings.resolutionOptions.1080pFullHD'), value: '1920x1080' },
    { label: t('videoSettings.resolutionOptions.1440p2K'), value: '2560x1440' },
    { label: t('videoSettings.resolutionOptions.2160p4KUHD'), value: '3840x2160' },
    { label: t('videoSettings.resolutionOptions.4kDci'), value: '4096x2160' },
    { label: t('videoSettings.resolutionOptions.ultrawide'), value: '3440x1440' },
  ];

  const aspectRatios = [
    { label: t('videoSettings.aspectRatios.16_9'), value: '16:9' },
    { label: t('videoSettings.aspectRatios.4_3'), value: '4:3' },
    { label: t('videoSettings.aspectRatios.21_9'), value: '21:9' },
    { label: t('videoSettings.aspectRatios.1_1'), value: '1:1' },
    { label: t('videoSettings.aspectRatios.9_16'), value: '9:16' },
    { label: '5:11', value: '5:11' },
    { label: '22:1', value: '22:1' },
  ];

  const fps_options = [
    { label: '3', value: '3' },
    { label: '11', value: '11' },
    { label: '24', value: '24' },
    { label: '25', value: '25' },
    { label: '30', value: '30' },
    { label: '48', value: '48' },
    { label: '50', value: '50' },
    { label: '60', value: '60' },
    { label: '90', value: '90' },
    { label: '120', value: '120' },
  ];

  const presetDescriptions: Record<string, string> = {
    ultrafast: t('ffmpegPresets.descriptions.ultrafast'),
    superfast: t('ffmpegPresets.descriptions.superfast'),
    veryfast: t('ffmpegPresets.descriptions.veryfast'),
    faster: t('ffmpegPresets.descriptions.faster'),
    fast: t('ffmpegPresets.descriptions.fast'),
    medium: t('ffmpegPresets.descriptions.medium'),
    slow: t('ffmpegPresets.descriptions.slow'),
    slower: t('ffmpegPresets.descriptions.slower'),
    veryslow: t('ffmpegPresets.descriptions.veryslow'),
  };

  const getSpeedLabel = (speed: number): string => {
    if (speed === 0.25) return '0.25x (Ultra Slow)';
    if (speed === 0.5) return '0.5x (Slow)';
    if (speed === 0.75) return '0.75x (Slower)';
    if (speed === 1) return '1x (Normal)';
    if (speed === 1.25) return '1.25x (Faster)';
    if (speed === 1.5) return '1.5x (Fast)';
    if (speed === 1.75) return '1.75x (Very Fast)';
    if (speed === 2) return '2x (Ultra Fast)';
    return `${speed}x`;
  };

  const handleFpsAutoChange = (enabled: boolean) => {
    setSettings({ ...settings, fpsAuto: enabled });
  };

  const handleFilterToggle = (filterName: string) => {
    setSettings(prev => ({
      ...prev,
      filters: prev.filters.map(f =>
        f.name === filterName ? { ...f, enabled: !f.enabled } : f
      )
    }));
  };

  const handleSelectWatermarkImage = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Image',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp']
        }]
      });

      if (selected && typeof selected === 'string') {
        setWatermarkSettings(prev => ({ ...prev, imagePath: selected }));
      }
    } catch (error) {
      console.error('Failed to select image:', error);
    }
  };
  return (
    <div className="settings-window fade-in" style={{ background: theme.colors.background, color: theme.colors.text }}>
      <header className="settings-header" style={{ background: theme.colors.surface, borderColor: theme.colors.border }}>
        <button onClick={onBack} className="back-button" style={{ color: theme.colors.primary }}>
          ← {t('buttons.back')}
        </button>
        <h1>{t('video.title')}</h1>
      </header>

      <div className="settings-content video-settings-extended">
        {/* Codec */}
        <div className="setting-group">
          <label>{t('video.codec')}</label>
          <select
            value={settings.codec}
            onChange={(e) => setSettings({ ...settings, codec: e.target.value })}
            style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
          >
            <option value="h264">{t('videoSettings.codecs.h264')}</option>
            <option value="h265">{t('videoSettings.codecs.h265')}</option>
            <option value="vp9">{t('videoSettings.codecs.vp9')}</option>
            <option value="av1">{t('videoSettings.codecs.av1')}</option>
          </select>
        </div>

        {/* Bitrate */}
        <div className="setting-group">
          <label>{t('video.bitrate')}</label>
          <input
            type="number"
            value={settings.bitrate}
            onChange={(e) => setSettings({ ...settings, bitrate: e.target.value })}
            style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
            min="0.5"
            max="100"
            step="0.5"
          />
        </div>

        {/* FPS with Auto */}
        <div className="setting-row">
          <div className="setting-group flex-1">
            <label>{t('videoSettings.fps')}</label>
            <select
              value={settings.fps}
              onChange={(e) => setSettings({ ...settings, fps: e.target.value })}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
              disabled={false}
            >
              {fps_options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label} {t('videoSettings.fpsShort')}</option>
              ))}
            </select>
          </div>
          <div className="setting-group checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.fpsAuto}
                onChange={(e) => handleFpsAutoChange(e.target.checked)}
                disabled={false}
              />
              <span>{t('videoSettings.autoFps')}</span>
            </label>
          </div>
        </div>

        {/* Resolution & Aspect Ratio */}
        <div className="setting-row">
          <div className="setting-group flex-1">
            <label>{t('videoSettings.resolution')}</label>
            <select
              value={settings.resolution}
              onChange={(e) => setSettings({ ...settings, resolution: e.target.value })}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
            >
              {resolutions.map(res => (
                <option key={res.value} value={res.value}>{res.label}</option>
              ))}
            </select>
          </div>
          <div className="setting-group flex-1">
            <label>{t('videoSettings.aspectRatio')}</label>
            <select
              value={settings.aspectRatio}
              onChange={(e) => setSettings({ ...settings, aspectRatio: e.target.value })}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
            >
              {aspectRatios.map(ar => (
                <option key={ar.value} value={ar.value}>{ar.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* CRF & Preset */}
        <div className="setting-row">
          <div className="setting-group flex-1">
            <div className="setting-label-with-help">
              <label>{t('videoSettings.crf')}</label>
              <button
                className="help-btn"
                onClick={() => setExpandedSection(expandedSection === 'crf' ? null : 'crf')}
                style={{ color: theme.colors.primary }}
              >
                ℹ️
              </button>
            </div>
            <input
              type="range"
              value={settings.crf}
              onChange={(e) => setSettings({ ...settings, crf: e.target.value })}
              min="0"
              max="51"
              step="1"
              style={{ width: '100%', cursor: 'pointer' }}
            />
            <div style={{ fontSize: '12px', color: theme.colors.textSecondary, marginTop: '4px' }}>
              CRF {settings.crf}
            </div>
          </div>

          <div className="setting-group flex-1">
            <label>{t('videoSettings.preset')}</label>
            <select
              value={settings.preset}
              onChange={(e) => setSettings({ ...settings, preset: e.target.value })}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
            >
              {Object.entries(presetDescriptions).map(([key, _desc]) => (
                <option key={key} value={key}>{t(`ffmpegPresets.${key}`)}</option>
              ))}
            </select>
            <div className="preset-description">{t('videoSettings.presetHint')}</div>
          </div>
        </div>

        {/* CRF Help */}
        {expandedSection === 'crf' && (
          <div className="help-section" style={{ background: theme.colors.surface, borderColor: theme.colors.border }}>
            <p>{t('videoSettings.crfHint')}</p>
          </div>
        )}

        {/* Speed Slider */}
        <div className="setting-group">
          <label>{t('videoSettings.speed')}</label>
          <div className="slider-with-label">
            <input
              type="range"
              value={settings.speed}
              onChange={(e) => setSettings({ ...settings, speed: parseFloat(e.target.value) })}
              min="0.25"
              max="2"
              step="0.25"
              style={{ flex: 1 }}
            />
            <span style={{ marginLeft: '12px', minWidth: '120px', color: theme.colors.textSecondary }}>
              {getSpeedLabel(settings.speed)}
            </span>
          </div>
        </div>

        {/* Transform Controls */}
        <div className="setting-row">
          <div className="setting-group flex-1">
            <label>{t('videoSettings.rotation')}</label>
            <select
              value={settings.rotation}
              onChange={(e) => setSettings({ ...settings, rotation: e.target.value as any })}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
            >
              <option value="none">{t('videoSettings.rotationOptions.none')}</option>
              <option value="90">{t('videoSettings.rotationOptions.deg90')}</option>
              <option value="180">{t('videoSettings.rotationOptions.deg180')}</option>
              <option value="270">{t('videoSettings.rotationOptions.deg270')}</option>
            </select>
          </div>

          <div className="setting-group flex-1">
            <label>{t('videoSettings.flip')}</label>
            <select
              value={settings.flip}
              onChange={(e) => setSettings({ ...settings, flip: e.target.value as any })}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
            >
              <option value="none">{t('videoSettings.flipOptions.none')}</option>
              <option value="horizontal">{t('videoSettings.flipOptions.horizontal')}</option>
              <option value="vertical">{t('videoSettings.flipOptions.vertical')}</option>
            </select>
          </div>
        </div>

        {/* Filters */}
        <div className="filters-section">
          <h3>{t('videoSettings.filters')}</h3>
          <div className="filters-grid">
            {settings.filters.map(filter => (
              <label key={filter.name} className="filter-checkbox">
                <input
                  type="checkbox"
                  checked={filter.enabled}
                  onChange={() => handleFilterToggle(filter.name)}
                />
                <span>{t(`videoSettings.filterNames.${filter.name}`)}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Watermark */}
        <div className="watermark-section" style={{ marginTop: '30px', paddingTop: '20px', borderTop: `1px solid ${theme.colors.border}` }}>
          <h3>{t('watermark.title')}</h3>
          
          <div className="setting-group">
            <label>{t('watermark.selectImage')}</label>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button onClick={handleSelectWatermarkImage} style={{ background: theme.colors.primary, color: '#fff', padding: '8px 16px', borderRadius: '6px' }}>
                {t('buttons.browse')}
              </button>
              {watermarkSettings.imagePath && (
                <span style={{ color: theme.colors.textSecondary, fontSize: '14px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {watermarkSettings.imagePath}
                </span>
              )}
            </div>
          </div>

          <div className="setting-group">
            <label>{t('watermark.position')}</label>
            <select value={watermarkSettings.position} onChange={(e) => setWatermarkSettings(prev => ({ ...prev, position: e.target.value as WatermarkSettingsType['position'] }))}
                    style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}>
              <option value="topLeft">{t('watermark.positions.topLeft')}</option>
              <option value="topRight">{t('watermark.positions.topRight')}</option>
              <option value="bottomLeft">{t('watermark.positions.bottomLeft')}</option>
              <option value="bottomRight">{t('watermark.positions.bottomRight')}</option>
              <option value="center">{t('watermark.positions.center')}</option>
            </select>
          </div>

          <div className="setting-group">
            <label>{t('watermark.opacity')} (%)</label>
            <input type="range" value={watermarkSettings.opacity} onChange={(e) => setWatermarkSettings(prev => ({ ...prev, opacity: Number(e.target.value) }))} 
                   min="0" max="100" />
            <span style={{ color: theme.colors.textSecondary }}>{watermarkSettings.opacity}%</span>
          </div>

          {watermarkSettings.imagePath && (
            <div className="setting-group">
              <label>{t('watermark.preview')}</label>
              <div style={{ 
                background: theme.colors.surface, 
                borderColor: theme.colors.border,
                padding: '20px',
                borderRadius: '8px',
                border: '1px solid',
                textAlign: 'center'
              }}>
                <img 
                  src={`file://${watermarkSettings.imagePath}`} 
                  alt="Watermark preview" 
                  style={{ 
                    maxWidth: '100%', 
                    maxHeight: '200px',
                    opacity: watermarkSettings.opacity / 100
                  }} 
                />
              </div>
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

export default VideoSettings;
