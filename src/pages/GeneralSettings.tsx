import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSettings, ScreenAnimationType } from '../contexts/SettingsContext';
import { FfmpegManager } from '../components/FfmpegManager';
import { VideoGuide } from '../components/VideoGuide';
import { APP_VERSION } from '../version';
import { UpdateService, UpdateState } from '../services/UpdateService';
import '../styles/SettingsWindow.css';

interface GeneralSettingsProps {
  onBack: () => void;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = ({ onBack }) => {
  const { t, setLanguage: setAppLanguage } = useLanguage();
  const { theme, setTheme: setAppTheme } = useTheme();
  const { screenAnimation, setScreenAnimation } = useSettings();
  
  const [themeName, setThemeName] = useState('light');
  const [language, setLanguage] = useState('ru');
  const [outputSuffix, setOutputSuffix] = useState('_szhatoe');
  const [screenAnimationLocal, setScreenAnimationLocal] = useState<ScreenAnimationType>(screenAnimation);
  const [gpuAvailable, setGpuAvailable] = useState<boolean>(false);
  const [showFfmpegManager, setShowFfmpegManager] = useState(false);
  const [showLogsWarning, setShowLogsWarning] = useState(false);
  const [logsPath, setLogsPath] = useState<string>('');
  const [warningTimer, setWarningTimer] = useState<number>(9);
  const [contextMenuStatus, setContextMenuStatus] = useState<{
    enabled: boolean;
    exe_valid: boolean;
    loading: boolean;
  }>({ enabled: false, exe_valid: false, loading: true });

  // Update state
  const [updateState, setUpdateState] = useState<UpdateState>(UpdateService.getState());
  const [showRestartPrompt, setShowRestartPrompt] = useState(false);

  useEffect(() => {
    loadSettings();
    loadLogsPath();
    checkContextMenuStatus();
    
    // Subscribe to update state changes
    const unsubscribe = UpdateService.subscribe(setUpdateState);
    
    // Initialize update service (silent check on mount)
    UpdateService.checkSilently();
    
    return () => {
      unsubscribe();
    };
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await invoke<any>('load_settings');
      setThemeName(settings.theme);
      setLanguage(settings.language);
      setOutputSuffix(settings.output_suffix);
      setGpuAvailable(!!settings.gpuAvailable);
      if (settings.screenAnimation) {
        setScreenAnimationLocal(settings.screenAnimation as ScreenAnimationType);
      }
      // First run GPU check if key missing
      if (settings.gpuAvailable === undefined) {
        try {
          const available = await invoke<boolean>('check_gpu_compatibility');
          setGpuAvailable(!!available);
        } catch (e) {
          console.warn('GPU check failed:', e);
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const loadLogsPath = async () => {
    try {
      const path = await invoke<string>('get_logs_path');
      setLogsPath(path);
    } catch (error) {
      console.error('Failed to load logs path:', error);
    }
  };

  const checkContextMenuStatus = async () => {
    try {
      const status = await invoke<{
        enabled: boolean;
        exe_valid: boolean;
      }>('check_context_menu_status');
      setContextMenuStatus({
        enabled: status.enabled,
        exe_valid: status.exe_valid,
        loading: false,
      });
    } catch (error) {
      console.error('Failed to check context menu status:', error);
      setContextMenuStatus({ enabled: false, exe_valid: false, loading: false });
    }
  };

  const handleAddContextMenu = async () => {
    try {
      await invoke('add_context_menu');
      await checkContextMenuStatus();
      alert(t('contextMenu.added'));
    } catch (error: unknown) {
      // Tauri errors can come as string or object with message
      const errorStr = typeof error === 'string' ? error : String(error);
      if (errorStr === 'ADMIN_REQUIRED' || errorStr.includes('ADMIN_REQUIRED')) {
        alert(t('contextMenu.adminRequired'));
      } else {
        console.error('Failed to add context menu:', error);
        alert(t('contextMenu.errorAdding'));
      }
    }
  };

  const handleRemoveContextMenu = async () => {
    try {
      await invoke('remove_context_menu');
      await checkContextMenuStatus();
      alert(t('contextMenu.removed'));
    } catch (error: unknown) {
      // Tauri errors can come as string or object with message
      const errorStr = typeof error === 'string' ? error : String(error);
      if (errorStr === 'ADMIN_REQUIRED' || errorStr.includes('ADMIN_REQUIRED')) {
        alert(t('contextMenu.adminRequired'));
      } else {
        console.error('Failed to remove context menu:', error);
        alert(t('contextMenu.errorRemoving'));
      }
    }
  };

  const handleShowLogsWarning = () => {
    setShowLogsWarning(true);
    setWarningTimer(9);
    const interval = setInterval(() => {
      setWarningTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleConfirmViewLogs = async () => {
    try {
      await invoke('open_logs_folder');
      setShowLogsWarning(false);
    } catch (error) {
      console.error('Failed to open logs folder:', error);
      alert(t('logs.errorOpening'));
    }
  };

  // Update handlers
  const handleCheckUpdate = async () => {
    await UpdateService.checkForUpdates();
  };

  const handleInstallUpdate = async () => {
    const downloaded = await UpdateService.installUpdate();
    if (downloaded) {
      setShowRestartPrompt(true);
    }
  };

  const handleRestartApp = async () => {
    // Apply update and restart
    await UpdateService.applyUpdate();
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
          screenAnimation: screenAnimationLocal,
        }
      });
      
      setAppTheme(themeName);
      setAppLanguage(language);
      setScreenAnimation(screenAnimationLocal);
      
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
        {/* Horizontal layout for theme, language, and screen animation */}
        <div style={{ 
          display: 'flex', 
          gap: '16px', 
          flexWrap: 'wrap', 
          marginBottom: '20px' 
        }}>
          <div className="setting-group" style={{ flex: '1 1 200px', minWidth: '200px' }}>
            <label>{t('settings.theme')}</label>
            <select value={themeName} onChange={(e) => setThemeName(e.target.value)}
                    style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}>
              <option value="light">Light</option>
              <option value="dark-red">Dark Red</option>
              <option value="blue-ocean">Blue Ocean</option>
              <option value="dark-blue">Dark Blue</option>
              <option value="dark-orange">Dark Orange</option>
              <option value="dark-green">Dark Green</option>
              <option value="purple-pink">Purple Pink (modified)</option>
            </select>
          </div>

          <div className="setting-group" style={{ flex: '1 1 200px', minWidth: '200px' }}>
            <label>{t('settings.language')}</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}
                    style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}>
              <option value="ru">Русский</option>
              <option value="en">English</option>
              <option value="ch">中文</option>
              <option value="eo">Esperanto</option>
              <option value="my">Medžuslovjansky</option>
              <option value="vz">🦖Взрывной😰</option>
              <option value="emp">    </option>
            </select>
          </div>

          <div className="setting-group" style={{ flex: '1 1 200px', minWidth: '200px' }}>
            <label>{t('settings.screenAnimation')}</label>
            <select 
              value={screenAnimationLocal} 
              onChange={(e) => setScreenAnimationLocal(e.target.value as ScreenAnimationType)}
              style={{ background: theme.colors.surface, color: theme.colors.text, borderColor: theme.colors.border }}
            >
              <option value="default">{t('settings.animations.default')}</option>
              <option value="soft-blur">{t('settings.animations.softBlur')}</option>
              <option value="physics">{t('settings.animations.physics')}</option>
              <option value="scale-fade">{t('settings.animations.scaleFade')}</option>
              <option value="none">{t('settings.animations.none')}</option>
            </select>
          </div>
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
          <label>{t('gpu.label')}</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={async () => {
                try {
                  // Validate FFmpeg paths before checking GPU
                  const ffmpegStatus = await invoke<any>('load_ffmpeg_paths');
                  const hasFfmpeg = !!ffmpegStatus?.ffmpeg_path?.trim();
                  const hasFfprobe = !!ffmpegStatus?.ffprobe_path?.trim();
                  
                  if (!hasFfmpeg || !hasFfprobe) {
                    alert(t('gpu.pathsNotConfigured'));
                    return;
                  }
                  
                  const available = await invoke<boolean>('check_gpu_compatibility');
                  setGpuAvailable(!!available);
                  await invoke('write_log', { message: `GPU NVENC available: ${available}` });
                  alert(available ? t('gpu.compatibleFound') : t('gpu.notFoundOrUnavailable'));
                } catch (e) {
                  console.error('GPU check error', e);
                  alert(t('gpu.checkError'));
                }
              }}
              style={{ background: theme.colors.primary, color: '#fff', padding: '8px 16px', border: 'none', borderRadius: 4 }}
            >
              {t('gpu.checkCompatibility')}
            </button>
            <span style={{ color: gpuAvailable ? theme.colors.success : theme.colors.error }}>
              {gpuAvailable ? t('gpu.available') : t('gpu.unavailable')}
            </span>
          </div>
        </div>

        {/* Context Menu Section */}
        <div className="setting-group">
          <label>{t('contextMenu.title')}</label>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: 12,
              background: theme.colors.surface,
              borderRadius: 8,
              border: `1px solid ${theme.colors.border}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: theme.colors.textSecondary }}>{t('contextMenu.status')}</span>
              {contextMenuStatus.loading ? (
                <span style={{ color: theme.colors.textSecondary }}>...</span>
              ) : (
                <span style={{ 
                  color: contextMenuStatus.enabled && contextMenuStatus.exe_valid 
                    ? theme.colors.success 
                    : contextMenuStatus.enabled && !contextMenuStatus.exe_valid
                    ? theme.colors.warning || '#f59e0b'
                    : theme.colors.error 
                }}>
                  {contextMenuStatus.enabled && contextMenuStatus.exe_valid
                    ? t('contextMenu.statusAdded')
                    : contextMenuStatus.enabled && !contextMenuStatus.exe_valid
                    ? t('contextMenu.statusInvalid')
                    : t('contextMenu.statusNotAdded')}
                </span>
              )}
            </div>

            {contextMenuStatus.enabled && !contextMenuStatus.exe_valid && (
              <div style={{ 
                padding: 8, 
                background: (theme.colors.warning || '#f59e0b') + '20', 
                borderRadius: 4,
                fontSize: 13,
                color: theme.colors.text
              }}>
                ⚠️ {t('contextMenu.exeMovedWarning')}
              </div>
            )}

            <button
              onClick={contextMenuStatus.enabled ? handleRemoveContextMenu : handleAddContextMenu}
              disabled={contextMenuStatus.loading}
              style={{
                background: contextMenuStatus.enabled ? theme.colors.error : theme.colors.primary,
                color: '#fff',
                padding: '10px 14px',
                border: 'none',
                borderRadius: 6,
                cursor: contextMenuStatus.loading ? 'not-allowed' : 'pointer',
                opacity: contextMenuStatus.loading ? 0.7 : 1,
              }}
            >
              {contextMenuStatus.enabled 
                ? `➖ ${t('contextMenu.remove')}`
                : `➕ ${t('contextMenu.add')}`}
            </button>

            <div style={{ fontSize: 12, color: theme.colors.textSecondary }}>
              {t('contextMenu.description')}
            </div>
          </div>
        </div>

        <VideoGuide title={t('videoGuide.title')} /> 

        <div className="setting-group">
          <label>{t('logs.title')}</label>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: 12,
              background: theme.colors.surface,
              borderRadius: 8,
              border: `1px solid ${theme.colors.border}`,
            }}
          >
            <button
              onClick={handleShowLogsWarning}
              style={{
                background: theme.colors.primary,
                color: '#fff',
                padding: '10px 14px',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              📂 {t('logs.viewFolder')}
            </button>
          </div>
        </div>

        <div className="setting-group">
          <label>{t('app.version')}</label>
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column',
            gap: 12,
            padding: 12,
            background: theme.colors.surface,
            borderRadius: 8,
            border: `1px solid ${theme.colors.border}`,
          }}>
            {/* Current version */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: theme.colors.textSecondary }}>v{APP_VERSION}</span>
              
              {/* Check for updates button */}
              <button
                onClick={handleCheckUpdate}
                disabled={updateState.status === 'checking' || updateState.status === 'downloading'}
                style={{
                  background: 'transparent',
                  color: theme.colors.primary,
                  border: 'none',
                  cursor: updateState.status === 'checking' || updateState.status === 'downloading' 
                    ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                  opacity: updateState.status === 'checking' ? 0.7 : 1,
                  padding: '4px 8px',
                }}
              >
                {updateState.status === 'checking' 
                  ? t('update.checking')
                  : t('update.checkForUpdates')}
              </button>
            </div>

            {/* Update available card */}
            {updateState.status === 'update-available' && updateState.info && (
              <div style={{
                padding: 12,
                background: theme.colors.primary + '15',
                borderRadius: 6,
                border: `1px solid ${theme.colors.primary}40`,
              }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  marginBottom: 8,
                }}>
                  <div>
                    <span style={{ color: theme.colors.textSecondary }}>
                      v{updateState.info.currentVersion}
                    </span>
                    <span style={{ margin: '0 8px', color: theme.colors.primary }}>→</span>
                    <span style={{ color: theme.colors.primary, fontWeight: 600 }}>
                      v{updateState.info.newVersion}
                    </span>
                  </div>
                  <button
                    onClick={handleInstallUpdate}
                    style={{
                      background: theme.colors.primary,
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '6px 12px',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    {t('update.install')}
                  </button>
                </div>
                {updateState.info.releaseNotes && (
                  <div style={{ 
                    fontSize: 12, 
                    color: theme.colors.textSecondary,
                    maxHeight: 60,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {updateState.info.releaseNotes.slice(0, 150)}
                    {updateState.info.releaseNotes.length > 150 && '...'}
                  </div>
                )}
              </div>
            )}

            {/* Downloading progress */}
            {updateState.status === 'downloading' && (
              <div style={{
                padding: 12,
                background: theme.colors.surface,
                borderRadius: 6,
                border: `1px solid ${theme.colors.border}`,
              }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 8,
                  color: theme.colors.primary,
                }}>
                  <span style={{ 
                    display: 'inline-block',
                    width: 14,
                    height: 14,
                    border: `2px solid ${theme.colors.primary}`,
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }} />
                  {t('update.downloading')}
                  {updateState.progress && updateState.progress.percent > 0 && (
                    <span style={{ marginLeft: 8 }}>
                      {updateState.progress.percent}%
                    </span>
                  )}
                </div>
                {/* Progress bar */}
                {updateState.progress && updateState.progress.total > 0 && (
                  <div style={{
                    marginTop: 8,
                    height: 4,
                    background: theme.colors.border,
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${updateState.progress.percent}%`,
                      background: theme.colors.primary,
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                )}
              </div>
            )}

            {/* Ready to install */}
            {updateState.status === 'ready-to-install' && (
              <div style={{
                padding: 12,
                background: theme.colors.success + '15',
                borderRadius: 6,
                border: `1px solid ${theme.colors.success}40`,
              }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  color: theme.colors.success,
                }}>
                  <span>✓ {t('update.readyToInstall')}</span>
                  <button
                    onClick={() => setShowRestartPrompt(true)}
                    style={{
                      background: theme.colors.success,
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '6px 12px',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    {t('update.restartNow')}
                  </button>
                </div>
              </div>
            )}

            {/* Up to date message */}
            {updateState.status === 'up-to-date' && (
              <div style={{ 
                fontSize: 13, 
                color: theme.colors.success,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                ✓ {t('update.upToDate')}
              </div>
            )}

            {/* Error message */}
            {updateState.status === 'error' && updateState.error && (
              <div style={{ 
                fontSize: 13, 
                color: theme.colors.error,
                padding: 8,
                background: theme.colors.error + '15',
                borderRadius: 4,
              }}>
                {updateState.error}
              </div>
            )}
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

      {/* Logs Warning Modal */}
      {showLogsWarning && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: theme.colors.background,
              borderRadius: 12,
              padding: 24,
              maxWidth: 500,
              width: '90%',
              border: `2px solid ${theme.colors.error}`,
            }}
          >
            <h2 style={{ marginTop: 0, color: theme.colors.error }}>⚠️ {t('logs.warningTitle')}</h2>
            <p style={{ lineHeight: 1.6, color: theme.colors.text }}>{t('logs.warningMessage')}</p>
            
            {logsPath && (
              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  background: theme.colors.surface,
                  borderRadius: 6,
                  border: `1px solid ${theme.colors.border}`,
                  filter: warningTimer > 0 ? 'blur(8px)' : 'none',
                  opacity: warningTimer > 0 ? 0.3 : 1,
                  transition: 'filter 0.3s ease, opacity 0.3s ease',
                  pointerEvents: warningTimer > 0 ? 'none' : 'auto',
                }}
              >
                <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginBottom: 4 }}>
                  {t('logs.pathLabel')}
                </div>
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 13,
                    color: theme.colors.text,
                    wordBreak: 'break-all',
                    userSelect: warningTimer > 0 ? 'none' : 'text',
                    cursor: warningTimer > 0 ? 'default' : 'text',
                  }}
                >
                  {logsPath}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button
                onClick={handleConfirmViewLogs}
                disabled={warningTimer > 0}
                style={{
                  flex: 1,
                  background: warningTimer > 0 ? theme.colors.border : theme.colors.primary,
                  color: '#fff',
                  padding: '12px',
                  border: 'none',
                  borderRadius: 6,
                  cursor: warningTimer > 0 ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {warningTimer > 0 ? `${t('logs.continue')} (${warningTimer}s)` : t('logs.continue')}
              </button>
              <button
                onClick={() => setShowLogsWarning(false)}
                style={{
                  flex: 1,
                  background: theme.colors.secondary,
                  color: '#fff',
                  padding: '12px',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {t('logs.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restart Prompt Modal */}
      {showRestartPrompt && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: theme.colors.background,
              borderRadius: 12,
              padding: 24,
              maxWidth: 400,
              width: '90%',
              border: `2px solid ${theme.colors.success}`,
            }}
          >
            <h2 style={{ marginTop: 0, color: theme.colors.success }}>
              ✓ {t('update.installed')}
            </h2>
            <p style={{ lineHeight: 1.6, color: theme.colors.text }}>
              {t('update.restartMessage')}
            </p>

            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button
                onClick={handleRestartApp}
                style={{
                  flex: 1,
                  background: theme.colors.success,
                  color: '#fff',
                  padding: '12px',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {t('update.restartNow')}
              </button>
              <button
                onClick={() => setShowRestartPrompt(false)}
                style={{
                  flex: 1,
                  background: theme.colors.secondary,
                  color: '#fff',
                  padding: '12px',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {t('update.restartLater')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
);
    
};
export default GeneralSettings;