import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import PresetManager from '../components/PresetManager';
import useRenderQueue from '../hooks/useRenderQueue';
import StatisticsPanel from '../components/StatisticsPanel';
import type { RenderJob } from '../services/RenderService';
import type {
  AppPreset,
  VideoSettings,
  AudioSettings,
  MainScreenSettings,
  WatermarkSettings,
} from '../types';
import '../styles/MainWindow.css';
console.log("Импорты завершены")

type Screen = 'main' | 'video' | 'audio' | 'general' | 'watermark';

interface MainWindowProps {
  onNavigate: (screen: Screen) => void;
  videoSettings: VideoSettings;
  setVideoSettings: React.Dispatch<React.SetStateAction<VideoSettings>>;
  audioSettings: AudioSettings;
  setAudioSettings: React.Dispatch<React.SetStateAction<AudioSettings>>;
  mainScreenSettings: MainScreenSettings;
  setMainScreenSettings: React.Dispatch<React.SetStateAction<MainScreenSettings>>;
  watermarkSettings: WatermarkSettings;
  setWatermarkSettings: React.Dispatch<React.SetStateAction<WatermarkSettings>>;
  selectedPresetName: string;
  setSelectedPresetName: React.Dispatch<React.SetStateAction<string>>;
}
const MainWindow: React.FC<MainWindowProps> = ({
  onNavigate,
  videoSettings,
  setVideoSettings,
  audioSettings,
  setAudioSettings,
  mainScreenSettings,
  setMainScreenSettings,
  watermarkSettings,
  setWatermarkSettings,
  selectedPresetName,
  setSelectedPresetName,
}) => {
  // console.log('MainWindow render');
  
  const { t } = useLanguage();
  const { theme } = useTheme();
  
  // Use RenderService hook for queue management
  const {
    jobs,
    isProcessing,
    isPaused,
    totalJobs,
    completedJobs,
    errorJobs,
    pendingJobs,
    addFiles,
    removeJob,
    clearCompleted,
    start,
    pause,
    resume,
    stop,
    // stopJob - available for individual job control if needed
    updateSettings,
    renderMode,
    gpuAvailable,
    setRenderMode,
  } = useRenderQueue();

  const [showStats, setShowStats] = useState(false);

  // Simple CPU/GPU toggle handler - switches between cpu and gpu modes
  const handleToggleRenderMode = useCallback(() => {
    if (!gpuAvailable) return; // Can't switch if GPU not available
    const newMode = renderMode === 'gpu' ? 'cpu' : 'gpu';
    setRenderMode(newMode);
  }, [renderMode, gpuAvailable, setRenderMode]);

  const closeStats = useCallback(() => setShowStats(false), []);

  // Close on Escape
  useEffect(() => {
    if (!showStats) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeStats();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showStats, closeStats]);

  // Update RenderService settings when preset changes
  useEffect(() => {
    updateSettings(videoSettings, audioSettings, watermarkSettings, mainScreenSettings, undefined, selectedPresetName);
  }, [videoSettings, audioSettings, watermarkSettings, mainScreenSettings, selectedPresetName, updateSettings]);

  const handleSelectFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Video',
          extensions: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm']
        }]
      });

      if (selected && Array.isArray(selected)) {
        await addFiles(selected);
        await invoke('write_log', { message: `Added ${selected.length} files to queue` });
      }
    } catch (error) {
      console.error('Failed to select files:', error);
    }
  };

  const handleSelectOutputFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false
      });

      if (selected && typeof selected === 'string') {
        setMainScreenSettings({
          ...mainScreenSettings,
          customOutputPath: selected,
        });
        await invoke('write_log', { message: `Set output folder: ${selected}` });
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
    }
  };

  const handleStart = async () => {
    try {
      await start();
      await invoke('write_log', { message: 'Started processing queue' });
    } catch (error) {
      console.error('Failed to start processing:', error);
      await invoke('write_log', { message: `Error starting: ${error}` });
    }
  };

  const handlePause = async () => {
    if (isPaused) {
      await resume();
      await invoke('write_log', { message: 'Resumed processing' });
    } else {
      pause();
      await invoke('write_log', { message: 'Paused processing' });
    }
  };

  const handleStop = async () => {
    await stop();
    await invoke('write_log', { message: 'Stopped processing' });
  };

  const handleRemoveJob = (jobId: string) => {
    removeJob(jobId);
  };

  const handleClearCompleted = () => {
    clearCompleted();
  };

  // Get status display text, color and icon
  const getStatusDisplay = (job: RenderJob) => {
    const statusConfig: Record<string, { text: string; color: string; icon: string }> = {
      pending: { text: 'Ожидание', color: theme.colors.textSecondary, icon: '⏳' },
      processing: { text: 'Рендеринг', color: theme.colors.primary, icon: '🔄' },
      completed: { text: 'Готово', color: theme.colors.success, icon: '✓' },
      error: { text: 'Ошибка', color: theme.colors.error, icon: '✗' },
      paused: { text: 'Пауза', color: theme.colors.warning, icon: '⏸' },
      stopped: { text: 'Остановлено', color: theme.colors.warning, icon: '■' },
    };
    
    return statusConfig[job.status] || statusConfig.pending;
  };

  const handleApplyPreset = (preset: AppPreset) => {
    setVideoSettings(preset.video);
    setAudioSettings(preset.audio);
    setMainScreenSettings(preset.mainScreen);
    if (preset.watermark) {
      setWatermarkSettings(preset.watermark);
    }
    setSelectedPresetName(preset.name || '');
    invoke('write_log', { message: `Applied preset: ${preset.name}` });
  };

  return ( 
    <div className="main-window fade-in" style={{ background: theme.colors.background, color: theme.colors.text }}>
      <header className="header" style={{ background: theme.colors.surface, borderColor: theme.colors.border }}>
        <h1>{t('app.title')}</h1>
        <div className="header-buttons">
          <button onClick={() => onNavigate('video')} style={{ background: theme.colors.primary, color: '#fff' }}>
            📹 {t('video.title')}
          </button>
          <button onClick={() => onNavigate('audio')} style={{ background: theme.colors.primary, color: '#fff' }}>
            🔊 {t('audio.title')}
          </button>
          <button onClick={() => onNavigate('watermark')} style={{ background: theme.colors.primary, color: '#fff' }}>
            🖼️ Watermark
          </button>
          <button onClick={() => onNavigate('general')} style={{ background: theme.colors.secondary, color: '#fff' }}>
            ⚙️ {t('settings.title')}
          </button>
          <button onClick={() => setShowStats(true)} style={{ background: theme.colors.primary, color: '#fff' }}>
            📊 {t('stats.title') || 'Statistics'}
          </button>
        </div>
      </header>

      <div className="content">
                {/* Preset Manager */}
                <PresetManager
                  currentVideoSettings={videoSettings}
                  currentAudioSettings={audioSettings}
                  currentMainScreenSettings={mainScreenSettings}
                  currentWatermarkSettings={watermarkSettings}
                  onApplyPreset={handleApplyPreset}
                  selectedPresetName={selectedPresetName}
                  setSelectedPresetName={setSelectedPresetName}
                />

        <div className="file-selection">
          <button onClick={handleSelectFiles} style={{ background: theme.colors.primary, color: '#fff' }}>
            📁 {t('main.selectFiles')}
          </button>

          <button onClick={handleSelectOutputFolder} style={{ background: theme.colors.primary, color: '#fff' }}>
            💾 {t('main.outputFolder')}
          </button>
          {mainScreenSettings.customOutputPath && (
            <div className="output-path" style={{ color: theme.colors.textSecondary }}>
              {mainScreenSettings.customOutputPath}
            </div>
          )}

          {/* Save in source directory checkbox */}
          <div className="save-location-option" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0' }}>
            <input
              type="checkbox"
              id="saveInSource"
              checked={mainScreenSettings.saveInSourceDirectory}
              onChange={(e) => setMainScreenSettings({
                ...mainScreenSettings,
                saveInSourceDirectory: e.target.checked,
              })}
            />
            <label htmlFor="saveInSource" style={{ color: theme.colors.text, cursor: 'pointer' }}>
              {t('main.saveInSourceDirectory')}
            </label>

            {/* CPU/GPU Toggle - single segmented button */}
            <div style={{ 
              display: 'flex', 
              border: `1px solid ${theme.colors.border}`,
              borderRadius: '4px',
              overflow: 'hidden',
              marginLeft: '16px'
            }}>
              <button
                onClick={handleToggleRenderMode}
                style={{
                  background: renderMode === 'cpu' || renderMode === 'duo' ? theme.colors.primary : theme.colors.surface,
                  color: renderMode === 'cpu' || renderMode === 'duo' ? '#fff' : theme.colors.text,
                  border: 'none',
                  padding: '4px 10px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  fontWeight: renderMode === 'cpu' ? 'bold' : 'normal',
                  fontSize: '0.85rem'
                }}
              >
                CPU
              </button>
              <button
                onClick={handleToggleRenderMode}
                disabled={!gpuAvailable}
                title={!gpuAvailable ? 'GPU недоступен — проверьте совместимость в настройках' : ''}
                style={{
                  background: renderMode === 'gpu' ? theme.colors.primary : theme.colors.surface,
                  color: renderMode === 'gpu' ? '#fff' : theme.colors.text,
                  border: 'none',
                  borderLeft: `1px solid ${theme.colors.border}`,
                  padding: '4px 10px',
                  cursor: gpuAvailable ? 'pointer' : 'not-allowed',
                  opacity: gpuAvailable ? 1 : 0.5,
                  transition: 'all 0.2s',
                  fontWeight: renderMode === 'gpu' ? 'bold' : 'normal',
                  fontSize: '0.85rem'
                }}
              >
                GPU
              </button>
            </div>
          </div>
          
        </div>

        <div className="queue-section">
          <div className="queue-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>{t('main.queue')} ({totalJobs})</h2>
            <div className="queue-stats" style={{ fontSize: '0.85rem', color: theme.colors.textSecondary }}>
              {completedJobs > 0 && <span style={{ color: theme.colors.success }}>✓ {completedJobs}</span>}
              {errorJobs > 0 && <span style={{ color: theme.colors.error, marginLeft: '8px' }}>✗ {errorJobs}</span>}
              {pendingJobs > 0 && <span style={{ marginLeft: '8px' }}>⏳ {pendingJobs}</span>}
              {completedJobs > 0 && (
                <button
                  onClick={handleClearCompleted}
                  style={{ 
                    marginLeft: '12px', 
                    padding: '2px 8px',
                    fontSize: '0.8rem',
                    background: theme.colors.surface,
                    color: theme.colors.text,
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Clear completed
                </button>
              )}
            </div>
          </div>
          <div className="queue-list" style={{ background: theme.colors.surface, borderColor: theme.colors.border }}>
            {jobs.length === 0 ? (
              <div className="empty-queue" style={{ color: theme.colors.textSecondary }}>
                {t('main.selectFiles')}...
              </div>
            ) : (
              jobs.map(item => {
                const statusDisplay = getStatusDisplay(item);
                return (
                  <div key={item.id} className="queue-item" style={{ borderColor: theme.colors.border }}>
                    <div className="item-info">
                      <div className="item-main-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                          {/* Status badge with icon */}
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 'bold',
                            background: `${statusDisplay.color}20`,
                            color: statusDisplay.color,
                            whiteSpace: 'nowrap'
                          }}>
                            <span>{statusDisplay.icon}</span>
                            <span>{statusDisplay.text}</span>
                          </span>
                          {/* CPU/GPU slot badge */}
                          {item.assignedSlot && item.status !== 'pending' && (
                            <span style={{
                              background: item.assignedSlot === 'gpu' ? theme.colors.success : theme.colors.primary,
                              color: '#fff',
                              padding: '3px 6px',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontWeight: 'bold'
                            }}>
                              {item.assignedSlot.toUpperCase()}
                            </span>
                          )}
                          {/* File name */}
                          <span className="item-name" title={item.inputPath} style={{ 
                            overflow: 'hidden', 
                            textOverflow: 'ellipsis', 
                            whiteSpace: 'nowrap',
                            flex: 1
                          }}>
                            {item.fileName}
                          </span>
                        </div>
                        <div className="item-actions" style={{ display: 'flex', gap: '10px', alignItems: 'center', marginLeft: '8px' }}>
                          {/* FPS and speed for processing */}
                          {item.status === 'processing' && (
                            <span style={{ fontSize: '0.8rem', color: theme.colors.textSecondary, whiteSpace: 'nowrap' }}>
                              {item.fps > 0 && `${item.fps.toFixed(1)} fps`}
                              {item.speed > 0 && ` • ${item.speed.toFixed(2)}x`}
                            </span>
                          )}
  
                          {/* Delete button - larger and more visible */}
                          {(item.status === 'pending' || item.status === 'completed' || item.status === 'error' || item.status === 'stopped') && (
                            <button
                              onClick={() => handleRemoveJob(item.id)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '28px',
                                height: '28px',
                                background: `${theme.colors.error}15`,
                                border: `1px solid ${theme.colors.error}40`,
                                borderRadius: '6px',
                                color: theme.colors.error,
                                cursor: 'pointer',
                                fontSize: '1.2rem',
                                fontWeight: 'bold',
                                transition: 'all 0.15s ease'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = `${theme.colors.error}30`;
                                e.currentTarget.style.borderColor = theme.colors.error;
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = `${theme.colors.error}15`;
                                e.currentTarget.style.borderColor = `${theme.colors.error}40`;
                              }}
                              title="Удалить из очереди"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </div>
                      {item.error && (
                        <div className="item-error" style={{ 
                          fontSize: '0.8rem', 
                          color: theme.colors.error,
                          marginTop: '4px',
                          padding: '4px 8px',
                          background: `${theme.colors.error}10`,
                          borderRadius: '4px'
                        }}>
                          {item.error}
                        </div>
                      )}
                    </div>
                    {(item.status === 'processing' || item.status === 'paused') && (
                      <div className="progress-section" style={{ marginTop: '8px' }}>
                        <div className="progress-bar" style={{ background: theme.colors.border, height: '8px', borderRadius: '4px' }}>
                          <div 
                            className="progress-fill" 
                            style={{ 
                              width: `${item.progress}%`, 
                              background: item.status === 'paused' ? theme.colors.warning : theme.colors.primary,
                              height: '100%',
                              borderRadius: '4px',
                              transition: 'width 0.3s ease'
                            }}
                          />
                        </div>
                        <div className="progress-details" style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          fontSize: '0.8rem', 
                          color: theme.colors.textSecondary,
                          marginTop: '4px'
                        }}>
                          <span>{item.progress.toFixed(1)}%</span>
                          <div style={{ display: 'flex', gap: '12px' }}>
                            {item.outputSizeBytes > 0 && (
                              <span style={{ fontFamily: 'monospace' }}>{item.outputSize}</span>
                            )}
                            <span>ETA: {item.etaFormatted}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {item.status === 'completed' && item.outputSizeBytes > 0 && (
                      <div className="completed-info" style={{ 
                        fontSize: '0.8rem', 
                        color: theme.colors.success,
                        marginTop: '4px',
                        display: 'flex',
                        gap: '8px'
                      }}>
                        <span>✓ Готово</span>
                        <span style={{ color: theme.colors.textSecondary, fontFamily: 'monospace' }}>
                          ({item.outputSize})
                        </span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="controls">
          <button 
            onClick={handleStart} 
            disabled={isProcessing || jobs.length === 0 || pendingJobs === 0}
            style={{ background: theme.colors.success, color: '#fff' }}
          >
            ▶️ {t('main.start')}
          </button>
          <button 
            onClick={handlePause} 
            disabled={!isProcessing}
            style={{ background: theme.colors.warning, color: '#fff' }}
          >
            {isPaused ? '▶️' : '⏸️'} {t('main.pause')}
          </button>
          <button 
            onClick={handleStop} 
            disabled={!isProcessing}
            style={{ background: theme.colors.error, color: '#fff' }}
          >
            ⏹️ {t('main.stop')}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showStats && (
          <motion.div
            className="stats-overlay"
            onClick={closeStats}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              className="stats-modal"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
            >
              <div className="stats-modal-header">
                <div className="stats-modal-title">{t('stats.title') || 'Render Statistics'}</div>
                <button className="stats-modal-close" onClick={closeStats} aria-label="Close statistics">
                  ×
                </button>
              </div>
              <StatisticsPanel onClose={closeStats} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MainWindow;
