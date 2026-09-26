import React, { useState, useMemo } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { VideoSettings as VideoSettingsType, WatermarkSettings as WatermarkSettingsType, DEFAULT_GIF_SETTINGS } from '../types/index';
import PreviewPanel from '../components/PreviewPanel';
import { useFirstJobInputPath } from '../hooks/useRenderQueue';
import { validateVideoSettings } from '../utils/videoValidation';
import { 
  Info, 
  AlertTriangle, 
  Film, 
  Sparkles, 
  Cpu, 
  Zap, 
  Sliders, 
  ChevronDown, 
  ChevronUp, 
  Layers, 
  Gamepad2, 
  Presentation, 
  Clapperboard 
} from 'lucide-react';
import '../styles/VideoSettings.css';
import '../styles/SettingsWindow.css';

interface VideoSettingsProps {
  onBack: () => void;
  settings: VideoSettingsType;
  setSettings: React.Dispatch<React.SetStateAction<VideoSettingsType>>;
  watermarkSettings: WatermarkSettingsType;
  setWatermarkSettings: React.Dispatch<React.SetStateAction<WatermarkSettingsType>>;
  renderMode?: 'cpu' | 'gpu' | 'duo';
  gpuAvailable?: boolean;
}

const VideoSettings: React.FC<VideoSettingsProps> = ({ 
  onBack, 
  settings, 
  setSettings,
  watermarkSettings,
  setWatermarkSettings,
  renderMode = 'cpu',
  gpuAvailable = false,
}) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const [expandedSection, setExpandedSection] = useState<'crf' | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAdvancedHelp, setShowAdvancedHelp] = useState(false);

  const isGifMode = settings.targetFormat === 'gif';
  const currentGifSettings = settings.gifSettings || DEFAULT_GIF_SETTINGS;

  const preferGpuForValidation = renderMode === 'gpu' || (renderMode === 'duo' && gpuAvailable);
  const validation = useMemo(() => {
    return validateVideoSettings(settings, preferGpuForValidation);
  }, [settings, preferGpuForValidation]);

  const handleUpdateGifSetting = (key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      gifSettings: {
        ...(prev.gifSettings || DEFAULT_GIF_SETTINGS),
        [key]: value,
      },
    }));
  };

  const gifWidthOptions = [
    { label: '200 px (Tiny)', value: '200' },
    { label: '240 px (Compact)', value: '240' },
    { label: '320 px (Mini)', value: '320' },
    { label: '480 px (Optimal)', value: '480' },
    { label: '640 px (Clear)', value: '640' },
    { label: '720 px (HD)', value: '720' },
    { label: 'Original', value: 'original' },
  ];

  const gifFpsOptions = [
    { label: '8 fps', value: '8' },
    { label: '10 fps', value: '10' },
    { label: '12 fps', value: '12' },
    { label: '15 fps (Recommended)', value: '15' },
    { label: '20 fps', value: '20' },
    { label: '24 fps', value: '24' },
    { label: '30 fps', value: '30' },
  ];

  const gifDitherOptions = [
    { label: t('videoSettings.gifDitherBayer') || 'Bayer (Crisp & light)', value: 'bayer' },
    { label: t('videoSettings.gifDitherFloyd') || 'Floyd-Steinberg (Smooth)', value: 'floyd_steinberg' },
    { label: t('videoSettings.gifDitherNone') || 'None', value: 'none' },
  ];
  
  // Get first file from render queue for preview
  const previewFilePath = useFirstJobInputPath();

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
    { label: '1', value: '1' },
    { label: '2', value: '2' },
    { label: '3', value: '3' },
    { label: '5', value: '5' },
    { label: '10', value: '10' },
    { label: '11', value: '11' },
    { label: '15', value: '15' },
    { label: '20', value: '20' },
    { label: '23.976', value: '23.976' },
    { label: '24', value: '24' },
    { label: '25', value: '25' },
    { label: '29.97', value: '29.97' },
    { label: '30', value: '30' },
    { label: '48', value: '48' },
    { label: '50', value: '50' },
    { label: '59.94', value: '59.94' },
    { label: '60', value: '60' },
    { label: '75', value: '75' },
    { label: '90', value: '90' },
    { label: '120', value: '120' },
    { label: '144', value: '144' },
    { label: '165', value: '165' },
    { label: '240', value: '240' },
    { label: '360', value: '360' },
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
    setSettings(prev => ({ ...prev, fpsAuto: enabled }));
  };

  const handleFilterToggle = (filterName: string) => {
    setSettings(prev => ({
      ...prev,
      filters: prev.filters.map(f =>
        f.name === filterName ? { ...f, enabled: !f.enabled } : f
      )
    }));
  };

  const handleContentTypeSelect = (type: 'standard' | 'gaming' | 'presentation' | 'cinema') => {
    setSettings(prev => {
      switch (type) {
        case 'gaming':
          return {
            ...prev,
            contentType: 'gaming',
            rateControlMode: 'crf',
            crf: '22',
            tune: 'film',
            gopSize: '2s',
            spatialAq: true,
            temporalAq: true,
            aqModeCpu: 'autovariance',
            nvencMultipass: 'fullres',
            preset: 'slow',
          };
        case 'presentation':
          return {
            ...prev,
            contentType: 'presentation',
            rateControlMode: 'crf',
            crf: '24',
            tune: 'stillimage',
            gopSize: '5s',
            preset: 'slower',
          };
        case 'cinema':
          return {
            ...prev,
            contentType: 'cinema',
            rateControlMode: 'crf',
            crf: '19',
            tune: 'film',
            gopSize: '5s',
            preset: 'slow',
          };
        case 'standard':
        default:
          return {
            ...prev,
            contentType: 'standard',
            rateControlMode: 'crf',
            crf: '23',
            tune: 'none',
            gopSize: 'auto',
            preset: 'medium',
          };
      }
    });
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

  const rateControlMode = settings.rateControlMode || 'crf';

  return (
    <div className="settings-window fade-in" style={{ color: theme.colors.text }}>
      <header className="settings-header" style={{ borderColor: theme.colors.border }}>
        <button onClick={onBack} className="back-button" style={{ color: theme.colors.primary }}>
          ← {t('buttons.back')}
        </button>
        <h1>{t('video.title')}</h1>
        {/* Preview Toggle Button */}
        <button 
          className="preview-toggle-header-btn"
          onClick={() => setShowPreview(!showPreview)}
          title={showPreview ? t('preview.hide') : t('preview.show')}
          style={{ 
            background: showPreview ? theme.colors.primary : 'transparent',
            borderColor: theme.colors.border
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {showPreview ? (
              <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
            ) : (
              <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>
            )}
          </svg>
        </button>
      </header>

      <div className={`video-settings-layout ${showPreview ? 'with-preview' : ''}`}>
        <div className="settings-content">
          <div className="video-settings-extended">
          
            {/* Active Render Mode Banner */}
            <div className="mode-info-card">
              {renderMode === 'duo' && (
                <>
                  <div className="mode-info-badge duo">
                    <Zap size={14} />
                    <span>DUO Mode</span>
                  </div>
                  <div className="mode-info-desc">
                    {t('videoSettings.modeDuoDesc') || 'Параллельный рендеринг: задачи распределяются между слотами CPU (libx264) и GPU (NVENC).'}
                  </div>
                </>
              )}
              {renderMode === 'gpu' && (
                <>
                  <div className="mode-info-badge gpu">
                    <Zap size={14} />
                    <span>GPU Mode</span>
                  </div>
                  <div className="mode-info-desc">
                    {t('videoSettings.modeGpuDesc') || 'Аппаратное кодирование через NVIDIA NVENC. Высокая скорость.'}
                  </div>
                </>
              )}
              {renderMode === 'cpu' && (
                <>
                  <div className="mode-info-badge cpu">
                    <Cpu size={14} />
                    <span>CPU Mode</span>
                  </div>
                  <div className="mode-info-desc">
                    {t('videoSettings.modeCpuDesc') || 'Программное кодирование (libx264/libx265). Максимальная эффективность сжатия.'}
                  </div>
                </>
              )}
            </div>

            {/* Validation Warnings Box */}
            {validation.warnings.length > 0 && !isGifMode && (
              <div className="validation-warning-box">
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>{t('videoSettings.validationNotice') || 'Рекомендация по оптимизации:'}</strong>
                  <ul>
                    {validation.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Output Format Switcher (Video vs GIF) */}
            <div className="setting-group" style={{ marginBottom: '4px' }}>
              <label style={{ fontWeight: 600, marginBottom: '4px', display: 'block' }}>
                {t('videoSettings.targetFormat')}
              </label>
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  padding: '4px',
                  background: 'rgba(var(--theme-bg-rgb), 0.25)',
                  borderRadius: '8px',
                  border: `1px solid ${theme.colors.border}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => setSettings(prev => ({ ...prev, targetFormat: 'video' }))}
                  style={{
                    flex: 1,
                    padding: '8px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    background: !isGifMode ? theme.colors.primary : 'transparent',
                    color: !isGifMode ? '#fff' : theme.colors.textSecondary,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Film size={16} strokeWidth={2} />
                  <span>{t('videoSettings.formatVideo')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSettings(prev => ({ ...prev, targetFormat: 'gif' }))}
                  style={{
                    flex: 1,
                    padding: '8px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    background: isGifMode ? (theme.colors.warning || theme.colors.primary) : 'transparent',
                    color: isGifMode ? '#fff' : theme.colors.textSecondary,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Sparkles size={16} strokeWidth={2} />
                  <span>{t('videoSettings.formatGif')}</span>
                </button>
              </div>
            </div>

            {isGifMode ? (
              /* GIF-specific Settings */
              <>
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: `${theme.colors.warning}15`,
                    border: `1px solid ${theme.colors.warning}40`,
                    color: theme.colors.text,
                    fontSize: '0.85rem',
                    marginBottom: '16px',
                    lineHeight: 1.4,
                  }}
                >
                  {t('videoSettings.gifNotice')}
                </div>

                {/* GIF Width & FPS */}
                <div className="setting-row">
                  <div className="setting-group flex-1">
                    <label>{t('videoSettings.gifWidth')}</label>
                    <select
                      value={currentGifSettings.width}
                      onChange={(e) => handleUpdateGifSetting('width', e.target.value)}
                    >
                      {gifWidthOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="setting-group flex-1">
                    <label>{t('videoSettings.gifFps')}</label>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <input
                        type="number"
                        value={currentGifSettings.fps}
                        onChange={(e) => handleUpdateGifSetting('fps', e.target.value)}
                        min="1"
                        max="120"
                        step="1"
                        placeholder="15"
                        style={{ flex: 1, minWidth: '60px' }}
                      />
                      <select
                        value={gifFpsOptions.some(opt => opt.value === currentGifSettings.fps) ? currentGifSettings.fps : 'custom'}
                        onChange={(e) => {
                          if (e.target.value !== 'custom') {
                            handleUpdateGifSetting('fps', e.target.value);
                          }
                        }}
                        style={{ width: '100px', flexShrink: 0 }}
                        title="Пресеты FPS"
                      >
                        <option value="custom" disabled hidden>Пресет...</option>
                        {!gifFpsOptions.some(opt => opt.value === currentGifSettings.fps) && currentGifSettings.fps && (
                          <option value="custom">{currentGifSettings.fps} fps</option>
                        )}
                        {gifFpsOptions.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* GIF Dithering */}
                <div className="setting-group">
                  <label>{t('videoSettings.gifDither')}</label>
                  <select
                    value={currentGifSettings.dither}
                    onChange={(e) => handleUpdateGifSetting('dither', e.target.value)}
                  >
                    {gifDitherOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              /* Video-specific Settings */
              <>
                {/* Content Profile Presets */}
                <div className="setting-group">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <label style={{ fontWeight: 600, margin: 0 }}>
                      {t('videoSettings.contentProfile') || 'Профиль оптимизации контента'}
                    </label>
                    {settings.contentType === 'custom' && (
                      <span style={{ fontSize: '11.5px', color: '#a3e635', fontWeight: 500 }}>
                        ✓ Настройки изменены вручную
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '6px' }}>
                    <button
                      type="button"
                      className={`segmented-btn ${settings.contentType === 'standard' ? 'active' : ''}`}
                      style={{ background: settings.contentType === 'standard' ? theme.colors.primary : 'rgba(255,255,255,0.05)' }}
                      onClick={() => handleContentTypeSelect('standard')}
                      title="Универсальные сбалансированные настройки"
                    >
                      <Layers size={14} />
                      <span>{t('videoSettings.contentStandard') || 'Универсальный'}</span>
                    </button>
                    <button
                      type="button"
                      className={`segmented-btn ${settings.contentType === 'gaming' ? 'active' : ''}`}
                      style={{ background: settings.contentType === 'gaming' ? theme.colors.primary : 'rgba(255,255,255,0.05)' }}
                      onClick={() => handleContentTypeSelect('gaming')}
                      title="Оптимизировано для динамичных клипов (Fortnite, Valorant) с быстрыми фликами и травой"
                    >
                      <Gamepad2 size={14} />
                      <span>{t('videoSettings.contentGaming') || 'Клипы / Игры'}</span>
                    </button>
                    <button
                      type="button"
                      className={`segmented-btn ${settings.contentType === 'presentation' ? 'active' : ''}`}
                      style={{ background: settings.contentType === 'presentation' ? theme.colors.primary : 'rgba(255,255,255,0.05)' }}
                      onClick={() => handleContentTypeSelect('presentation')}
                      title="Оптимизировано для вебинаров и статичных презентаций (минимальный вес на статике)"
                    >
                      <Presentation size={14} />
                      <span>{t('videoSettings.contentPresentation') || 'Вебинар / Слайды'}</span>
                    </button>
                    <button
                      type="button"
                      className={`segmented-btn ${settings.contentType === 'cinema' ? 'active' : ''}`}
                      style={{ background: settings.contentType === 'cinema' ? theme.colors.primary : 'rgba(255,255,255,0.05)' }}
                      onClick={() => handleContentTypeSelect('cinema')}
                      title="Высокое кинематографичное качество для фильмов и сериалов"
                    >
                      <Clapperboard size={14} />
                      <span>{t('videoSettings.contentCinema') || 'Кино'}</span>
                    </button>
                  </div>
                </div>

                {/* Codec */}
                <div className="setting-group">
                  <label>{t('video.codec')}</label>
                  <select
                    value={settings.codec}
                    onChange={(e) => setSettings(prev => ({ ...prev, codec: e.target.value }))}
                  >
                    <option value="h264">{t('videoSettings.codecs.h264')}</option>
                    <option value="h265">{t('videoSettings.codecs.h265')}</option>
                    <option value="vp9">{t('videoSettings.codecs.vp9')}</option>
                    <option value="av1">{t('videoSettings.codecs.av1')}</option>
                  </select>
                </div>

                {/* Rate Control Mode (CRF vs VBR vs Constrained CRF vs CBR) */}
                <div className="setting-group">
                  <label style={{ fontWeight: 600 }}>{t('videoSettings.rateControlMode') || 'Режим контроля сжатия'}</label>
                  <div className="segmented-control">
                    <button
                      type="button"
                      className={`segmented-btn ${rateControlMode === 'crf' ? 'active' : ''}`}
                      style={{ background: rateControlMode === 'crf' ? theme.colors.primary : 'transparent' }}
                      onClick={() => setSettings(prev => ({ ...prev, rateControlMode: 'crf', contentType: 'custom' }))}
                    >
                      <span>{t('videoSettings.rcCrf') || 'CRF (Качество)'}</span>
                    </button>
                    <button
                      type="button"
                      className={`segmented-btn ${rateControlMode === 'constrained_crf' ? 'active' : ''}`}
                      style={{ background: rateControlMode === 'constrained_crf' ? theme.colors.primary : 'transparent' }}
                      onClick={() => setSettings(prev => ({ ...prev, rateControlMode: 'constrained_crf', contentType: 'custom' }))}
                    >
                      <span>{t('videoSettings.rcConstrainedCrf') || 'CRF + Лимит'}</span>
                    </button>
                    <button
                      type="button"
                      className={`segmented-btn ${rateControlMode === 'vbr' ? 'active' : ''}`}
                      style={{ background: rateControlMode === 'vbr' ? theme.colors.primary : 'transparent' }}
                      onClick={() => setSettings(prev => ({ ...prev, rateControlMode: 'vbr', contentType: 'custom' }))}
                    >
                      <span>{t('videoSettings.rcVbr') || 'VBR (Битрейт)'}</span>
                    </button>
                    <button
                      type="button"
                      className={`segmented-btn ${rateControlMode === 'cbr' ? 'active' : ''}`}
                      style={{ background: rateControlMode === 'cbr' ? theme.colors.primary : 'transparent' }}
                      onClick={() => setSettings(prev => ({ ...prev, rateControlMode: 'cbr', contentType: 'custom' }))}
                    >
                      <span>{t('videoSettings.rcCbr') || 'CBR'}</span>
                    </button>
                  </div>
                </div>

                {/* Resolution & Bitrate parameters */}
                <div className="setting-row">
                  <div className="setting-group flex-1">
                    <label>{t('videoSettings.resolution')}</label>
                    <select
                      value={settings.resolution}
                      onChange={(e) => setSettings(prev => ({ ...prev, resolution: e.target.value }))}
                    >
                      {resolutions.map(res => (
                        <option key={res.value} value={res.value}>{res.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Conditional Bitrate input for VBR / CBR / Constrained CRF */}
                  {(rateControlMode === 'vbr' || rateControlMode === 'cbr' || rateControlMode === 'constrained_crf') && (
                    <div className="setting-group flex-1">
                      <label>
                        {rateControlMode === 'constrained_crf' 
                          ? (t('videoSettings.maxBitrate') || 'Макс. битрейт (Mbps)') 
                          : t('video.bitrate')}
                      </label>
                      <input
                        type="number"
                        value={settings.bitrate}
                        onChange={(e) => setSettings(prev => ({ ...prev, bitrate: e.target.value }))}
                        min="0.1"
                        max="100"
                        step="0.5"
                      />
                    </div>
                  )}
                </div>

                {/* Aspect Ratio & FPS */}
                <div className="setting-row">
                  <div className="setting-group flex-1">
                    <label>{t('videoSettings.aspectRatio')}</label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <select
                        value={settings.aspectRatio}
                        onChange={(e) => setSettings(prev => ({ ...prev, aspectRatio: e.target.value }))}
                        style={{ flex: 1 }}
                        disabled={settings.aspectRatioAuto}
                      >
                        {aspectRatios.map(ar => (
                          <option key={ar.value} value={ar.value}>{ar.label}</option>
                        ))}
                      </select>
                      <label className="checkbox-label" style={{ margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={settings.aspectRatioAuto || false}
                          onChange={(e) => setSettings(prev => ({ ...prev, aspectRatioAuto: e.target.checked }))}
                        />
                        <span>{t('videoSettings.autoAspectRatio')}</span>
                      </label>
                    </div>
                  </div>
                  <div className="setting-group flex-1">
                    <label>{t('videoSettings.fps')}</label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <div style={{ display: 'flex', flex: 1, gap: '6px', alignItems: 'center' }}>
                        <input
                          type="number"
                          value={settings.fpsAuto ? '' : settings.fps}
                          onChange={(e) => setSettings(prev => ({ ...prev, fps: e.target.value }))}
                          placeholder={settings.fpsAuto ? (t('videoSettings.autoFps') || 'Авто') : '30'}
                          min="0.1"
                          max="1000"
                          step="any"
                          disabled={settings.fpsAuto}
                          style={{ flex: 1, minWidth: '60px' }}
                        />
                        <select
                          value={fps_options.some(opt => opt.value === settings.fps) ? settings.fps : 'custom'}
                          onChange={(e) => {
                            if (e.target.value !== 'custom') {
                              setSettings(prev => ({ ...prev, fps: e.target.value }));
                            }
                          }}
                          disabled={settings.fpsAuto}
                          style={{ width: '100px', flexShrink: 0 }}
                          title="Пресеты FPS"
                        >
                          <option value="custom" disabled hidden>Пресет...</option>
                          {!fps_options.some(opt => opt.value === settings.fps) && settings.fps && (
                            <option value="custom">{settings.fps} fps</option>
                          )}
                          {fps_options.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label} {t('videoSettings.fpsShort') || 'fps'}</option>
                          ))}
                        </select>
                      </div>
                      <label className="checkbox-label" style={{ margin: 0, flexShrink: 0 }}>
                        <input
                          type="checkbox"
                          checked={settings.fpsAuto}
                          onChange={(e) => handleFpsAutoChange(e.target.checked)}
                        />
                        <span>{t('videoSettings.autoFps')}</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* CRF & Preset Controls */}
                <div className="setting-row">
                  {(rateControlMode === 'crf' || rateControlMode === 'constrained_crf') && (
                    <div className="setting-group flex-1">
                      <div className="setting-label-with-help">
                        <label>{t('videoSettings.crf')}</label>
                        <button
                          className="help-btn"
                          onClick={() => setExpandedSection(expandedSection === 'crf' ? null : 'crf')}
                          style={{ color: theme.colors.primary, display: 'flex', alignItems: 'center' }}
                        >
                          <Info size={16} strokeWidth={2} />
                        </button>
                      </div>
                      <input
                        type="range"
                        value={settings.crf}
                        onChange={(e) => setSettings(prev => ({ ...prev, crf: e.target.value, contentType: 'custom' }))}
                        min="0"
                        max={settings.codec === 'vp9' || settings.codec === 'av1' ? '63' : '51'}
                        step="1"
                        style={{ width: '100%', cursor: 'pointer' }}
                      />
                      <div style={{ fontSize: '12px', color: theme.colors.textSecondary, marginTop: '4px' }}>
                        CRF {settings.crf} {parseInt(settings.crf, 10) <= 20 ? '(Высокое качество)' : parseInt(settings.crf, 10) <= 26 ? '(Сбалансированное)' : '(Максимальное сжатие)'}
                      </div>
                    </div>
                  )}

                  <div className="setting-group flex-1">
                    <label>{t('videoSettings.preset')}</label>
                    <select
                      value={settings.preset}
                      onChange={(e) => setSettings(prev => ({ ...prev, preset: e.target.value, contentType: 'custom' }))}
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
                  <div className="help-section">
                    <p>{t('videoSettings.crfHint')}</p>
                  </div>
                )}

                {/* Advanced Compression Accordion */}
                <div style={{ marginTop: '4px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      type="button"
                      className="advanced-toggle-btn"
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      style={{ flex: 1 }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Sliders size={16} />
                        <span>{t('videoSettings.advancedCompression') || 'Расширенные параметры сжатия (GOP, AQ, 10-bit)'}</span>
                      </span>
                      {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAdvancedHelp(!showAdvancedHelp);
                        if (!showAdvanced) setShowAdvanced(true);
                      }}
                      style={{
                        color: showAdvancedHelp ? '#fff' : theme.colors.primary,
                        background: showAdvancedHelp ? theme.colors.primary : 'rgba(var(--theme-bg-rgb), 0.25)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: '8px',
                        width: '38px',
                        height: '38px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        flexShrink: 0,
                        transition: 'all 0.2s ease',
                      }}
                      title="Подсказки по расширенным параметрам: что и когда выставлять"
                    >
                      <Info size={18} strokeWidth={2} />
                    </button>
                  </div>

                  {/* Beginner-friendly Advanced Options Help Card */}
                  {showAdvancedHelp && (
                    <div className="advanced-help-card">
                      <div className="advanced-help-header">
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Info size={18} strokeWidth={2} />
                          <span>Подсказки для новичков: какие параметры выставлять?</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowAdvancedHelp(false)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'inherit',
                            cursor: 'pointer',
                            fontSize: '18px',
                            lineHeight: 1,
                            padding: '2px 6px',
                            opacity: 0.8,
                          }}
                          title="Закрыть подсказку"
                        >
                          ✕
                        </button>
                      </div>

                      <div className="advanced-help-notice">
                        💡 <strong>Главный совет:</strong> если вы сомневаетесь, просто выберите готовый <strong>«Профиль оптимизации контента»</strong> вверху страницы (например, <em>Клипы / Игры</em> или <em>Вебинар / Слайды</em>). Программа автоматически подберет идеальные значения всех этих параметров под вашу задачу!
                      </div>

                      <div className="advanced-help-grid">
                        <div className="advanced-help-item">
                          <div className="advanced-help-item-title">
                            ⏱️ Интервал ключевых кадров (GOP)
                          </div>
                          <div className="advanced-help-item-desc">
                            Частота сохранения опорных кадров (I-frame). Влияет на плавность перемотки по таймлайну и итоговый размер файла.
                          </div>
                          <div className="advanced-help-item-rec">
                            ✓ Рекомендация: <strong>2 сек</strong> для динамичных игр/клипов (быстрая перемотка в TG/Discord); <strong>5-10 сек</strong> для вебинаров (сильно уменьшит вес).
                          </div>
                        </div>

                        <div className="advanced-help-item">
                          <div className="advanced-help-item-title">
                            🎨 Глубина цвета (Pixel Format)
                          </div>
                          <div className="advanced-help-item-desc">
                            yuv420p — стандартный 8-битный цвет для всех устройств. yuv420p10le — 10-битный цвет, убирающий «лесенки» (бандинг) на небе и тенях.
                          </div>
                          <div className="advanced-help-item-rec">
                            ✓ Рекомендация: <strong>yuv420p</strong> для максимальной совместимости; <strong>10-bit</strong> при сжатии в кодеках H.265 (HEVC) и AV1.
                          </div>
                        </div>

                        <div className="advanced-help-item">
                          <div className="advanced-help-item-title">
                            ⚡ Аппаратное декодирование (HW Decoding)
                          </div>
                          <div className="advanced-help-item-desc">
                            Распаковка исходного файла на видеокарте (GPU) вместо процессора. Разгружает процессор и ускоряет сжатие в 1.5–2 раза.
                          </div>
                          <div className="advanced-help-item-rec">
                            ✓ Рекомендация: <strong>Авто (Рекомендуется)</strong> — программа сама выберет оптимальный декодер GPU под ваш файл.
                          </div>
                        </div>

                        <div className="advanced-help-item">
                          <div className="advanced-help-item-title">
                            🎯 Тюнинг энкодера (-tune)
                          </div>
                          <div className="advanced-help-item-desc">
                            Тонкая калибровка кодека под специфику картинки (фильмы, рисованная графика или статика).
                          </div>
                          <div className="advanced-help-item-rec">
                            ✓ Рекомендация: <strong>film</strong> для реалистичных 3D-игр и кино; <strong>stillimage</strong> для слайдов и вебинаров.
                          </div>
                        </div>

                        <div className="advanced-help-item">
                          <div className="advanced-help-item-title">
                            👁️ Adaptive Quantization (AQ)
                          </div>
                          <div className="advanced-help-item-desc">
                            Адаптивная четкость: перераспределяет биты в кадре так, чтобы трава, листва, асфальт и мелкие детали в движении не превращались в мыло.
                          </div>
                          <div className="advanced-help-item-rec">
                            ✓ Рекомендация: <strong>Auto-Variance AQ</strong> для динамичных шутеров (Fortnite, Valorant, CS).
                          </div>
                        </div>

                        <div className="advanced-help-item">
                          <div className="advanced-help-item-title">
                            🎞️ B-кадры (Двунаправленные)
                          </div>
                          <div className="advanced-help-item-desc">
                            Кадры, сжимаемые одновременно по предыдущему и последующему кадрам. Обеспечивают максимальную степень компрессии.
                          </div>
                          <div className="advanced-help-item-rec">
                            ✓ Рекомендация: <strong>3 кадра</strong> (золотой стандарт соотношения веса и качества).
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {showAdvanced && (
                    <div className="advanced-options-card">
                      {/* GOP Keyframe Interval */}
                      <div className="setting-row">
                        <div className="advanced-field flex-1">
                          <label>{t('videoSettings.gopSize') || 'Интервал ключевых кадров (GOP)'}</label>
                          <select
                            value={settings.gopSize || 'auto'}
                            onChange={(e) => setSettings(prev => ({ ...prev, gopSize: e.target.value, contentType: 'custom' }))}
                          >
                            <option value="auto">Авто (по умолчанию)</option>
                            <option value="1s">1 сек (Клипы Discord/TG)</option>
                            <option value="2s">2 сек (Гейминг 60 fps)</option>
                            <option value="5s">5 сек (Сбалансированно)</option>
                            <option value="10s">10 сек (Вебинары / Слайды)</option>
                          </select>
                        </div>

                        {/* Pixel Format */}
                        <div className="advanced-field flex-1">
                          <label>{t('videoSettings.pixelFormat') || 'Формат / Глубина цвета'}</label>
                          <select
                            value={settings.pixelFormat || 'yuv420p'}
                            onChange={(e) => setSettings(prev => ({ ...prev, pixelFormat: e.target.value as any }))}
                          >
                            <option value="yuv420p">yuv420p (8-bit совместимость)</option>
                            <option value="yuv420p10le">yuv420p10le (10-bit без бандинга)</option>
                          </select>
                        </div>
                      </div>

                      {/* Tuning & AQ */}
                      <div className="setting-row">
                        <div className="advanced-field flex-1">
                          <label>{t('videoSettings.tune') || 'Тюнинг энкодера (-tune)'}</label>
                          <select
                            value={settings.tune || 'none'}
                            onChange={(e) => setSettings(prev => ({ ...prev, tune: e.target.value as any, contentType: 'custom' }))}
                          >
                            <option value="none">Без тюнинга</option>
                            <option value="film">film (Четкость текстур)</option>
                            <option value="stillimage">stillimage (Статика / Слайды)</option>
                            <option value="animation">animation (Аниме / 2D)</option>
                            <option value="grain">grain (Зерно)</option>
                            <option value="fastdecode">fastdecode (Быстрый декод)</option>
                          </select>
                        </div>

                        <div className="advanced-field flex-1">
                          <label>{t('videoSettings.aqMode') || 'Adaptive Quantization (AQ)'}</label>
                          <select
                            value={settings.aqModeCpu || 'autovariance'}
                            onChange={(e) => setSettings(prev => ({ ...prev, aqModeCpu: e.target.value as any, contentType: 'custom' }))}
                          >
                            <option value="autovariance">Auto-Variance AQ (Игры)</option>
                            <option value="darkscenes">Auto-Variance (Темные сцены)</option>
                            <option value="variance">Variance AQ (Стандарт)</option>
                            <option value="disabled">Отключено</option>
                          </select>
                        </div>
                      </div>

                      {/* HW Decoding & B-Frames */}
                      <div className="setting-row">
                        <div className="advanced-field flex-1">
                          <label>{t('videoSettings.hwaccel') || 'Аппаратное декодирование (HW Decoding)'}</label>
                          <select
                            value={settings.hwaccel || 'auto'}
                            onChange={(e) => setSettings(prev => ({ ...prev, hwaccel: e.target.value as any }))}
                          >
                            <option value="auto">Авто (Рекомендуется)</option>
                            <option value="cuda">NVIDIA CUDA (NVDEC)</option>
                            <option value="d3d11va">Direct3D 11 (D3D11VA)</option>
                            <option value="dxva2">DirectX VA 2.0 (DXVA2)</option>
                            <option value="qsv">Intel Quick Sync (QSV)</option>
                            <option value="disabled">Отключено (Только CPU)</option>
                          </select>
                        </div>

                        <div className="advanced-field flex-1">
                          <label>{t('videoSettings.bFrames') || 'B-кадры (Двунаправленные)'}</label>
                          <select
                            value={settings.bFrames !== undefined ? settings.bFrames.toString() : '3'}
                            onChange={(e) => setSettings(prev => ({ ...prev, bFrames: parseInt(e.target.value, 10), contentType: 'custom' }))}
                          >
                            <option value="0">0 (Без B-кадров, минимальная задержка)</option>
                            <option value="2">2 кадра</option>
                            <option value="3">3 кадра (Рекомендуется)</option>
                            <option value="4">4 кадра (Высокое сжатие)</option>
                            <option value="8">8 кадров (Максимальное сжатие)</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Speed Slider */}
            <div className="setting-group">
              <label>{t('videoSettings.speed')}</label>
              <div className="slider-with-label">
                <input
                  type="range"
                  value={settings.speed}
                  onChange={(e) => setSettings(prev => ({ ...prev, speed: parseFloat(e.target.value) }))}
                  min="0.25"
                  max="2"
                  step="0.25"
                  style={{ flex: 1 }}
                />
                <span style={{ minWidth: '110px', color: theme.colors.textSecondary, fontSize: '13px' }}>
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
                  onChange={(e) => setSettings(prev => ({ ...prev, rotation: e.target.value as any }))}
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
                  onChange={(e) => setSettings(prev => ({ ...prev, flip: e.target.value as any }))}
                >
                  <option value="none">{t('videoSettings.flipOptions.none')}</option>
                  <option value="horizontal">{t('videoSettings.flipOptions.horizontal')}</option>
                  <option value="vertical">{t('videoSettings.flipOptions.vertical')}</option>
                </select>
              </div>
            </div>

            {/* Filters */}
            {!isGifMode && (
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
            )}

            {/* Watermark */}
            <div className="watermark-section" style={{ marginTop: '20px', paddingTop: '16px', borderTop: `1px solid ${theme.colors.border}` }}>
              <div className="setting-group">
                <label>{t('watermark.selectImage')}</label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button onClick={handleSelectWatermarkImage} style={{ background: theme.colors.primary, color: '#fff', padding: '8px 16px', borderRadius: '6px' }}>
                    {t('buttons.browse')}
                  </button>
                  {watermarkSettings.imagePath && (
                    <span style={{ color: theme.colors.textSecondary, fontSize: '13px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {watermarkSettings.imagePath}
                    </span>
                  )}
                </div>
              </div>

              <div className="setting-group">
                <label>{t('watermark.position')}</label>
                <select value={watermarkSettings.position} onChange={(e) => setWatermarkSettings(prev => ({ ...prev, position: e.target.value as WatermarkSettingsType['position'] }))}>
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
                  <div className="glass-card" style={{ 
                    padding: '16px',
                    borderRadius: '8px',
                    textAlign: 'center'
                  }}>
                    <img 
                      src={`file://${watermarkSettings.imagePath}`} 
                      alt="Watermark preview" 
                      style={{ 
                        maxWidth: '100%', 
                        maxHeight: '180px',
                        opacity: watermarkSettings.opacity / 100
                      }} 
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Preview Panel - Right Side */}
        {showPreview && previewFilePath && (
          <div className="video-settings-preview">
            <PreviewPanel
              videoPath={previewFilePath} 
              videoSettings={{
                codec: isGifMode ? 'h264' : settings.codec,
                crf: settings.crf,
                fps: isGifMode ? (settings.gifSettings?.fps || '15') : settings.fps,
                resolution: isGifMode && settings.gifSettings?.width && settings.gifSettings.width !== 'original'
                  ? `${settings.gifSettings.width}x-2`
                  : settings.resolution,
                bitrate: settings.bitrate,
                preset: settings.preset,
                filters: isGifMode ? [] : settings.filters,
                resamplingEnabled: isGifMode ? false : settings.resamplingEnabled,
                resamplingIntensity: settings.resamplingIntensity,
                rateControlMode: settings.rateControlMode,
                tune: settings.tune,
              }}
              preferGpu={preferGpuForValidation}
              isVisible={showPreview}
              onToggle={() => setShowPreview(!showPreview)}
              embedded={true}
            />
          </div>
        )}
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
