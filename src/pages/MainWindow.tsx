import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import PresetManager from '../components/PresetManager';
import RenderModeSelector from '../components/RenderModeSelector';
import PreviewPanel from '../components/PreviewPanel';
import useRenderQueue from '../hooks/useRenderQueue';
import StatisticsPanel from '../components/StatisticsPanel';
import { UpdateService, UpdateState } from '../services/UpdateService';
import { Film, Volume2, Settings, BarChart3, Folder, Play, Pause, Square, RefreshCw, Sparkles, HardDrive, Check, X, Clock, AlertTriangle } from 'lucide-react';
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

const FolderSyncIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg
    aria-hidden
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: 'block' }}
  >
    <path
      d="M3 6h6l2 2h9v8a2 2 0 0 1-2 2H3V6Z"
      stroke={color}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <path
      d="M9.5 12.5a3.5 3.5 0 1 1 6.94 1"
      stroke={color}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <path
      d="M15.5 15.5V17m0 0h1.5M15.5 17h-1.5"
      stroke={color}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <path
      d="M8.5 10.5V9m0 0H7M8.5 9h1.5"
      stroke={color}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);

type Screen = 'main' | 'video' | 'audio' | 'general';

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
  cliFiles?: string[];
  onCliFilesProcessed?: () => void;
}

interface NetworkProxyVpnStatus {
  proxy_enabled: boolean;
  proxy_details: string[];
  vpn_likely_active: boolean;
  vpn_interfaces: string[];
  clash_likely_active: boolean;
  clash_details: string[];
  warning_needed: boolean;
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
  cliFiles,
  onCliFilesProcessed,
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
    addToQueue,
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
  const [showPreview, setShowPreview] = useState(false);
  const [selectedPreviewPath, setSelectedPreviewPath] = useState<string>('');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [networkWarning, setNetworkWarning] = useState<string | null>(null);

  // Check for updates after 2 seconds
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        await UpdateService.initialize();
        const info = await UpdateService.checkForUpdates();
        if (info) {
          setUpdateAvailable(true);
          console.log('[MainWindow] Update available:', info.newVersion);
        }
      } catch (error) {
        console.log('[MainWindow] Update check failed:', error);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  // Check active VPN/proxy on startup and show safety warning
  useEffect(() => {
    const checkNetworkRisk = async () => {
      try {
        const today = new Date().toDateString();
        const dismissedDate = localStorage.getItem('vpnWarningDismissedDate');
        if (dismissedDate === today) {
          return; // User already dismissed this warning today
        }

        const result = await invoke<NetworkProxyVpnStatus>('check_network_proxy_vpn_status');
        if (!result.warning_needed) {
          return;
        }

        const translated = t('network.vpnProxyWarningMessage');
        const baseMessage = translated === 'network.vpnProxyWarningMessage'
          ? 'Обнаружено активное proxy/VPN соединение. Рекомендуется отключить его, чтобы программа работала стабильнее и без сетевых ошибок.'
          : translated;

        setNetworkWarning(baseMessage);

        const logDetails: string[] = [];
        if (result.proxy_enabled && result.proxy_details.length > 0) {
          logDetails.push(`proxy=${result.proxy_details.join(' | ')}`);
        }
        if (result.vpn_likely_active && result.vpn_interfaces.length > 0) {
          logDetails.push(`vpnInterfaces=${result.vpn_interfaces.join(' | ')}`);
        }
        if (result.clash_likely_active && result.clash_details.length > 0) {
          logDetails.push(`clash=${result.clash_details.join(' | ')}`);
        }

        await invoke('write_log', {
          message: `[MainWindow] Network warning shown at startup. ${logDetails.join(' || ') || 'No extra details'}`,
        });
      } catch (error) {
        console.warn('Network proxy/VPN check failed:', error);
      }
    };

    checkNetworkRisk();
  }, [t]);
  useEffect(() => {
    if (jobs.length > 0 && !selectedPreviewPath) {
      setSelectedPreviewPath(jobs[0].inputPath);
    }
  }, [jobs, selectedPreviewPath]);

  const handleToggleSaveInSourceDirectory = useCallback(() => {
    setMainScreenSettings((prev) => ({
      ...prev,
      saveInSourceDirectory: !prev.saveInSourceDirectory,
    }));
  }, [setMainScreenSettings]);

  // Handler for setting specific render mode
  const handleSetRenderMode = useCallback((mode: 'cpu' | 'gpu' | 'duo') => {
    // Can't use GPU/Duo if GPU not available
    if (!gpuAvailable && mode !== 'cpu') return;
    setRenderMode(mode);
  }, [gpuAvailable, setRenderMode]);

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

  // Handle CLI files (from context menu)
  useEffect(() => {
    if (cliFiles && cliFiles.length > 0) {
      console.log('[MainWindow] Adding CLI files to queue:', cliFiles);
      addFiles(cliFiles).then(() => {
        console.log('[MainWindow] CLI files added successfully');
        onCliFilesProcessed?.();
      }).catch(err => {
        console.error('[MainWindow] Failed to add CLI files:', err);
      });
    }
  }, [cliFiles, addFiles, onCliFilesProcessed]);

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
    const statusConfig: Record<string, { text: string; color: string; icon: React.ReactNode }> = {
      pending: { text: t('queue.status.pending'), color: theme.colors.textSecondary, icon: <Clock size={14} strokeWidth={2} /> },
      processing: { text: t('queue.status.processing'), color: theme.colors.primary, icon: <RefreshCw size={14} strokeWidth={2} /> },
      completed: { text: t('queue.status.completed'), color: theme.colors.success, icon: <Check size={14} strokeWidth={2} /> },
      error: { text: t('queue.status.error'), color: theme.colors.error, icon: <X size={14} strokeWidth={2} /> },
      paused: { text: t('queue.status.paused'), color: theme.colors.warning, icon: <Pause size={14} strokeWidth={2} /> },
      stopped: { text: t('queue.status.stopped'), color: theme.colors.warning, icon: <Square size={14} strokeWidth={2} /> },
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

  const handleShowInExplorer = async (filePath: string) => {
    try {
      await invoke('show_in_explorer', { filePath });
    } catch (error) {
      console.error('Failed to show file in explorer:', error);
      // Optionally show a notification to user
    }
  };

  return ( 
    <div className="main-window fade-in" style={{ color: theme.colors.text }}>
      <header className="header" style={{ borderColor: theme.colors.border }}>
        <h1>{t('app.title')}</h1>
        <div className="header-buttons">
          <button onClick={() => onNavigate('video')} style={{ background: theme.colors.primary, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Film size={18} strokeWidth={1.5} /> {t('video.title')}
          </button>
          <button onClick={() => onNavigate('audio')} style={{ background: theme.colors.primary, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Volume2 size={18} strokeWidth={1.5} /> {t('audio.title')}
          </button>
          <button 
            onClick={() => onNavigate('general')} 
            style={{ 
              background: updateAvailable ? theme.colors.success : theme.colors.secondary, 
              color: '#fff',
              animation: updateAvailable ? 'pulse 2s infinite' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {updateAvailable ? <Sparkles size={18} strokeWidth={1.5} /> : <Settings size={18} strokeWidth={1.5} />} {updateAvailable ? t('settings.update_available') : t('settings.title')}
          </button>
          <button onClick={() => setShowStats(true)} style={{ background: theme.colors.primary, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <BarChart3 size={18} strokeWidth={1.5} /> {t('stats.title') || 'Statistics'}
          </button>
        </div>
      </header>

      {networkWarning && (
        <div
          style={{
            position: 'fixed',
            top: '12px',
            left: '12px',
            right: '12px',
            zIndex: 9999,
            pointerEvents: 'none',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 'min(92vw, 760px)',
              padding: '12px 14px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: 'rgba(18, 18, 20, 0.95)',
              border: `1px solid ${theme.colors.warning}`,
              color: '#fff',
              fontSize: '0.95rem',
              lineHeight: 1.4,
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
              backdropFilter: 'blur(8px)',
              pointerEvents: 'auto',
            }}
          >
            <AlertTriangle size={18} strokeWidth={2.25} color={theme.colors.warning} />
            <span style={{ flex: 1, fontWeight: 500 }}>{networkWarning}</span>
            <button
              onClick={() => {
                setNetworkWarning(null);
                localStorage.setItem('vpnWarningDismissedDate', new Date().toDateString());
              }}
              aria-label="Close network warning"
              style={{
                border: `1px solid ${theme.colors.warning}`,
                background: theme.colors.warning,
                color: '#111',
                borderRadius: '6px',
                width: '30px',
                height: '30px',
                cursor: 'pointer',
                fontSize: '1.05rem',
                fontWeight: 700,
                lineHeight: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Close"
            >
              ×
            </button>
          </div>
        </div>
      )}

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
          <button onClick={handleSelectFiles} style={{ background: theme.colors.primary, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Folder size={18} strokeWidth={1.5} /> {t('main.selectFiles')}
          </button>
          <div className="output-controls" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={handleSelectOutputFolder}
              style={{
                background: theme.colors.primary,
                color: '#fff',
                opacity: mainScreenSettings.saveInSourceDirectory ? 0.5 : 1,
                cursor: mainScreenSettings.saveInSourceDirectory ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
              disabled={mainScreenSettings.saveInSourceDirectory}
            >
              <HardDrive size={18} strokeWidth={1.5} /> {t('main.outputFolder')}
            </button>

            <motion.button
              type="button"
              aria-pressed={mainScreenSettings.saveInSourceDirectory}
              onClick={handleToggleSaveInSourceDirectory}
              title={t('main.saveInSourceDirectory')}
              initial={false}
              animate={{
                backgroundColor: mainScreenSettings.saveInSourceDirectory ? theme.colors.primary : 'transparent',
                color: mainScreenSettings.saveInSourceDirectory ? '#fff' : theme.colors.textSecondary,
                scale: mainScreenSettings.saveInSourceDirectory ? 1.05 : 1,
              }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              style={{
                border: `1px solid ${theme.colors.border}`,
                borderRadius: '6px',
                padding: '8px 10px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                minWidth: 40,
              }}
            >
              <FolderSyncIcon color={mainScreenSettings.saveInSourceDirectory ? '#fff' : theme.colors.text} />
            </motion.button>
          </div>

          {mainScreenSettings.customOutputPath && (
            <div className="output-path" style={{ color: theme.colors.textSecondary }}>
              {mainScreenSettings.customOutputPath}
            </div>
          )}

          {/* CPU/GPU/Duo Toggle - Advanced visual selector */}
          <div style={{ padding: '8px 0' }}>
            <RenderModeSelector
              mode={renderMode}
              onModeChange={handleSetRenderMode}
              gpuAvailable={gpuAvailable}
              isRendering={isProcessing}
            />
          </div>
          
        </div>

        <div className="queue-section">
          <div className="queue-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>{t('main.queue')} ({totalJobs})</h2>
            <div className="queue-stats" style={{ fontSize: '0.85rem', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: '8px' }}>
              {completedJobs > 0 && <span style={{ color: theme.colors.success, display: 'flex', alignItems: 'center', gap: '4px' }}><Check size={14} strokeWidth={2} /> {completedJobs}</span>}
              {errorJobs > 0 && <span style={{ color: theme.colors.error, display: 'flex', alignItems: 'center', gap: '4px' }}><X size={14} strokeWidth={2} /> {errorJobs}</span>}
              {pendingJobs > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={14} strokeWidth={2} /> {pendingJobs}</span>}
              {completedJobs > 0 && (
                <button
                  onClick={handleClearCompleted}
                  style={{ 
                    marginLeft: '12px', 
                    padding: '2px 8px',
                    fontSize: '0.8rem',
                    background: 'rgba(var(--theme-bg-rgb), 0.2)',
                    backdropFilter: 'blur(8px)',
                    color: theme.colors.text,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  {t('queue.clearCompleted')}
                </button>
              )}
            </div>
          </div>
          <div className="queue-list" style={{ borderColor: theme.colors.border }}>
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
  
                          {/* Re-render buttons for completed tasks */}
                          {item.status === 'completed' && (
                            <>
                              <button
                                onClick={() => addToQueue(item.inputPath, item.outputPath)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '4px 8px',
                                  background: `${theme.colors.success}15`,
                                  border: `1px solid ${theme.colors.success}40`,
                                  borderRadius: '6px',
                                  color: theme.colors.success,
                                  cursor: 'pointer',
                                  fontSize: '0.75rem',
                                  fontWeight: '500',
                                  transition: 'all 0.15s ease'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = `${theme.colors.success}30`;
                                  e.currentTarget.style.borderColor = theme.colors.success;
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = `${theme.colors.success}15`;
                                  e.currentTarget.style.borderColor = `${theme.colors.success}40`;
                                }}
                                title={t('history.re_render_overwrite') || 'Re-render (overwrite)'}
                              >
                                ↻
                              </button>
                              <button
                                onClick={() => {
                                  const lastDot = item.outputPath.lastIndexOf('.');
                                  const outputPathNew = lastDot > 0 
                                    ? item.outputPath.substring(0, lastDot) + '_2' + item.outputPath.substring(lastDot)
                                    : item.outputPath + '_2';
                                  addToQueue(item.inputPath, outputPathNew);
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '4px 8px',
                                  background: `${theme.colors.primary}15`,
                                  border: `1px solid ${theme.colors.primary}40`,
                                  borderRadius: '6px',
                                  color: theme.colors.primary,
                                  cursor: 'pointer',
                                  fontSize: '0.75rem',
                                  fontWeight: '500',
                                  transition: 'all 0.15s ease'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = `${theme.colors.primary}30`;
                                  e.currentTarget.style.borderColor = theme.colors.primary;
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = `${theme.colors.primary}15`;
                                  e.currentTarget.style.borderColor = `${theme.colors.primary}40`;
                                }}
                                title={t('history.re_render_new') || 'Re-render (new version)'}
                              >
                                ↻2
                              </button>
                            </>
                          )}

                          {/* Show in Explorer button for completed tasks */}
                          {item.status === 'completed' && item.outputPath && (
                            <button
                              onClick={() => handleShowInExplorer(item.outputPath)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '4px 8px',
                                background: `${theme.colors.success}15`,
                                border: `1px solid ${theme.colors.success}40`,
                                borderRadius: '6px',
                                color: theme.colors.success,
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                fontWeight: '500',
                                transition: 'all 0.15s ease'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = `${theme.colors.success}30`;
                                e.currentTarget.style.borderColor = theme.colors.success;
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = `${theme.colors.success}15`;
                                e.currentTarget.style.borderColor = `${theme.colors.success}40`;
                              }}
                              title={t('queue.showInExplorer') || 'Show in Explorer'}
                            >
                              <Folder size={14} strokeWidth={1.5} /> {t('queue.show') || 'Show'}
                            </button>
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
                              title={t('queue.deleteFromQueue')}
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
                              <span style={{ fontFamily: 'monospace' }}>
                                {item.outputSize}
                                {item.estimatedFinalSize && (
                                  <span style={{ color: theme.colors.textSecondary }}>
                                    {' / '}{item.estimatedFinalSize}
                                  </span>
                                )}
                              </span>
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
                        <span>{t('queue.completedWithSize')}</span>
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
            style={{ background: theme.colors.success, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Play size={18} strokeWidth={1.5} /> {t('main.start')}
          </button>
          <button 
            onClick={handlePause} 
            disabled={!isProcessing}
            style={{ background: theme.colors.warning, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {isPaused ? <Play size={18} strokeWidth={1.5} /> : <Pause size={18} strokeWidth={1.5} />} {t('main.pause')}
          </button>
          <button 
            onClick={handleStop} 
            disabled={!isProcessing}
            style={{ background: theme.colors.error, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Square size={18} strokeWidth={1.5} /> {t('main.stop')}
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
              style={{ color: theme.colors.text }}
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

      {/* Live Preview Panel */}
      <PreviewPanel
        inputPath={selectedPreviewPath}
        settings={{
          codec: videoSettings.codec,
          crf: videoSettings.crf,
          fps: videoSettings.fps,
          resolution: videoSettings.resolution,
          filters: videoSettings.filters.filter(f => f.enabled).map(f => f.name),
          resampling_enabled: !!videoSettings.resamplingEnabled,
          resampling_intensity: videoSettings.resamplingIntensity || 5,
        }}
        isVisible={showPreview}
        onToggleVisibility={() => setShowPreview(!showPreview)}
      />
    </div>
  );
};

export default MainWindow;
