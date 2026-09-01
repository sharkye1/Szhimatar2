import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { appWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/api/dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { Suspense, lazy } from 'react';
import RenderJobItem from '../components/RenderJobItem';
import DownloadJobItem from '../components/DownloadJobItem';
import useRenderQueue from '../hooks/useRenderQueue';
import useDownloadQueue from '../hooks/useDownloadQueue';
import { isSelfDragActive } from '../hooks/useFileDragOut';

const PresetManager = lazy(() => import('../components/PresetManager'));
const PreviewPanel = lazy(() => import('../components/PreviewPanel'));
const StatisticsPanel = lazy(() => import('../components/StatisticsPanel'));
import { UpdateService, UpdateState } from '../services/UpdateService';
import { Film, Volume2, Settings, BarChart3, Folder, Play, Pause, Square, RefreshCw, Sparkles, HardDrive, Check, X, Clock, AlertTriangle, Trash2, Download, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import type { RenderJob } from '../services/RenderService';
import type { DownloadQueueItem, DownloadStatus } from '../services/DownloadService';
import type {
  AppPreset,
  VideoSettings,
  AudioSettings,
  MainScreenSettings,
  WatermarkSettings,
} from '../types';
import '../styles/MainWindow.css';
console.log("Imports completed");

const SUPPORTED_VIDEO_EXTENSIONS = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', '3gp', 'ts', 'mts', 'm2ts', 'vob', 'ogv', 'mpg', 'mpeg'];
const VIDEO_EXT_REGEX = new RegExp(`\\.(${SUPPORTED_VIDEO_EXTENSIONS.join('|')})$`, 'i');

type DownloadFormatOption = {
  label: string;
  quality: string;
  format: string;
  ext: string;
  height?: number | null;
  filesize?: number | null;
  is_audio_only: boolean;
};

interface VideoMetadataResponse {
  title?: string | null;
  duration?: number | null;
  formats: DownloadFormatOption[];
}

const DEFAULT_DOWNLOAD_FORMATS: DownloadFormatOption[] = [
  {
    label: 'MP4 Best',
    quality: 'bestvideo+bestaudio/best',
    format: 'mp4',
    ext: 'mp4',
    height: null,
    filesize: null,
    is_audio_only: false,
  },
  {
    label: 'MP3',
    quality: 'bestaudio/best',
    format: 'mp3',
    ext: 'mp3',
    height: null,
    filesize: null,
    is_audio_only: true,
  },
];

const createDownloadJobId = () => `download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const formatDownloadBytes = (bytes?: number | null) => {
  if (!bytes || bytes <= 0) {
    return '';
  }

  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const formatDownloadHeight = (height?: number | null) => {
  if (!height) {
    return 'Best';
  }

  return `${height}p`;
};

const normalizeDownloadFormats = (formats: DownloadFormatOption[]) => {
  const merged = [...formats];

  if (!merged.some((item) => item.format === 'mp4')) {
    merged.unshift(DEFAULT_DOWNLOAD_FORMATS[0]);
  }

  if (!merged.some((item) => item.format === 'mp3')) {
    merged.push(DEFAULT_DOWNLOAD_FORMATS[1]);
  }

  return merged;
};

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

type TrimHandleType = 'start' | 'end';

interface TrimFramePreviewState {
  jobId: string;
  handle: TrimHandleType;
  timeSec: number;
  leftPercent: number;
  imageDataUrl: string | null;
  loading: boolean;
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
    updateJobTrim,
    removeJob,
    clearCompleted,
    start,
    pause,
    resume,
    stop,
    stopJob,
    updateSettings,
    renderMode,
    gpuAvailable,
    setRenderMode,
  } = useRenderQueue();

  const {
    downloadQueue,
    startDownload,
    stopDownload,
    removeDownloadJob,
    clearCompletedDownloads,
  } = useDownloadQueue();

  const trimStepSec = 0.5;
  const minTrimDurationSec = 1;

  const [showStats, setShowStats] = useState(false);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('isHeaderCollapsed') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleHeaderCollapsed = useCallback((collapsed?: boolean) => {
    setIsHeaderCollapsed((prev) => {
      const next = typeof collapsed === 'boolean' ? collapsed : !prev;
      try {
        localStorage.setItem('isHeaderCollapsed', String(next));
      } catch (e) {
        console.warn('Failed to save isHeaderCollapsed to localStorage:', e);
      }
      return next;
    });
  }, []);

  const [showPreview, setShowPreview] = useState(false);
  const [selectedPreviewPath, setSelectedPreviewPath] = useState<string>('');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [networkWarning, setNetworkWarning] = useState<string | null>(null);
  const [trimFramePreview, setTrimFramePreview] = useState<TrimFramePreviewState | null>(null);
  const trimPreviewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trimPreviewHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trimPreviewRequestRef = useRef(0);
  const trimPreviewCacheRef = useRef<Map<string, string>>(new Map());
  const downloadFormatsRequestRef = useRef(0);

  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadFormats, setDownloadFormats] = useState<DownloadFormatOption[]>(DEFAULT_DOWNLOAD_FORMATS);
  const [selectedDownloadFormat, setSelectedDownloadFormat] = useState(DEFAULT_DOWNLOAD_FORMATS[0].label);
  const [parsedVideoTitle, setParsedVideoTitle] = useState<string>('');
  const [isLoadingDownloadFormats, setIsLoadingDownloadFormats] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDropError, setIsDropError] = useState(false);
  const [isDropSuccess, setIsDropSuccess] = useState(false);
  const [ripplePos, setRipplePos] = useState<{ x: number; y: number } | null>(null);
  const emptyStateRef = useRef<HTMLDivElement>(null);
  const queueListRef = useRef<HTMLDivElement>(null);
  const lastPointerPosRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const dropErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerDropError = useCallback(() => {
    if (dropErrorTimeoutRef.current) {
      clearTimeout(dropErrorTimeoutRef.current);
    }
    setIsDropError(true);
    dropErrorTimeoutRef.current = setTimeout(() => {
      setIsDropError(false);
    }, 600);
  }, []);

  const triggerDropSuccess = useCallback((customCoords?: { clientX: number; clientY: number } | null) => {
    if (dropSuccessTimeoutRef.current) {
      clearTimeout(dropSuccessTimeoutRef.current);
    }

    const pointer = customCoords !== undefined ? customCoords : lastPointerPosRef.current;
    const targetEl = emptyStateRef.current || queueListRef.current;

    if (pointer && targetEl) {
      const rect = targetEl.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, pointer.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, pointer.clientY - rect.top));
      setRipplePos({ x, y });
    } else {
      setRipplePos(null);
    }

    setIsDropSuccess(true);
    dropSuccessTimeoutRef.current = setTimeout(() => {
      setIsDropSuccess(false);
      setRipplePos(null);
    }, 950);
  }, []);

  // Cleanup drop timers on unmount
  useEffect(() => {
    return () => {
      if (dropErrorTimeoutRef.current) {
        clearTimeout(dropErrorTimeoutRef.current);
      }
      if (dropSuccessTimeoutRef.current) {
        clearTimeout(dropSuccessTimeoutRef.current);
      }
    };
  }, []);

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

  useEffect(() => {
    const trimmed = downloadUrl.trim();

    if (!trimmed) {
      setDownloadFormats(DEFAULT_DOWNLOAD_FORMATS);
      setSelectedDownloadFormat(DEFAULT_DOWNLOAD_FORMATS[0].label);
      setParsedVideoTitle('');
      setIsLoadingDownloadFormats(false);
      return;
    }

    if (!/^https?:\/\//i.test(trimmed)) {
      setDownloadFormats(DEFAULT_DOWNLOAD_FORMATS);
      setSelectedDownloadFormat(DEFAULT_DOWNLOAD_FORMATS[0].label);
      setParsedVideoTitle('');
      setIsLoadingDownloadFormats(false);
      return;
    }

    const requestId = ++downloadFormatsRequestRef.current;
    setIsLoadingDownloadFormats(true);

    const timer = setTimeout(async () => {
      try {
        const metadata = await invoke<VideoMetadataResponse>('get_video_formats', { url: trimmed });

        if (requestId !== downloadFormatsRequestRef.current) {
          return;
        }

        if (metadata.title) {
          setParsedVideoTitle(metadata.title);
        }

        const formatsList = metadata.formats?.length ? metadata.formats : DEFAULT_DOWNLOAD_FORMATS;
        const normalized = normalizeDownloadFormats(formatsList);
        setDownloadFormats(normalized);

        setSelectedDownloadFormat((current) => (
          normalized.some((item) => item.label === current) ? current : normalized[0]?.label || DEFAULT_DOWNLOAD_FORMATS[0].label
        ));
      } catch (error) {
        if (requestId !== downloadFormatsRequestRef.current) {
          return;
        }

        console.warn('[MainWindow] Failed to load download formats:', error);
        setDownloadFormats(DEFAULT_DOWNLOAD_FORMATS);
        setSelectedDownloadFormat(DEFAULT_DOWNLOAD_FORMATS[0].label);
      } finally {
        if (requestId === downloadFormatsRequestRef.current) {
          setIsLoadingDownloadFormats(false);
        }
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [downloadUrl]);

  // Check active VPN/proxy on startup and show safety warning
  useEffect(() => {
    const checkNetworkRisk = async () => {
      try {
        const today = new Date().toDateString();
        const dismissedDate = localStorage.getItem('vpnWarningDismissedDate');
        if (dismissedDate === today) {
          return; // User already dismissed this warning today
        }

        // чтобы полностью отключить проверку впн соединения на уровне бэкенда надо возвращать из функции check_network_proxy_vpn_status результат с warning_needed=false, тогда фронтенд даже не будет пытаться показывать предупреждение и логировать детали сети. Но пока что пусть возвращает реальные данные для диагностики и возможного будущего отображения предупреждения.
        // можно просто не вызывать эту функцию вовсе, но пусть она пока что вызывается, чтобы не забыть про эту проверку и иметь возможность быстро её включить при необходимости. В будущем, если будет принято решение показывать предупреждение при определённых условиях, то уже будет готова вся необходимая логика на фронтенде, останется только правильно настроить возвращаемые данные из бэкенда.
        const result = { proxy_enabled: false, proxy_details: [], vpn_likely_active: false, vpn_interfaces: [], clash_likely_active: false, clash_details: [], warning_needed: false };

        const warning_needed = false;
        if (!warning_needed) {
          return;
        }

        const translated = t('network.vpnProxyWarningMessage');
        const baseMessage = translated === 'network.vpnProxyWarningMessage'
          ? 'Обнаружено активное proxy/VPN соединение. Рекомендуется отключить его, чтобы программа работала стабильнее и без сетевых ошибок.'
          : translated;


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

        // Intentionally no app.log write here to keep app.log clean from network diagnostics.
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

  useEffect(() => {
    const handlePaste = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        try {
          const text = await navigator.clipboard.readText();
          if (/tiktok\.com|youtube\.com|youtu\.be|instagram\.com\/reel/i.test(text.trim())) {
            setDownloadUrl(text.trim());
            setShowUrlInput(true);
          }
        } catch {
          // clipboard access denied
        }
      }
    };
    window.addEventListener('keydown', handlePaste);
    return () => window.removeEventListener('keydown', handlePaste);
  }, []);

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
        triggerDropSuccess();
        onCliFilesProcessed?.();
      }).catch(err => {
        console.error('[MainWindow] Failed to add CLI files:', err);
      });
    }
  }, [cliFiles, addFiles, onCliFilesProcessed, triggerDropSuccess]);

  const handleSelectFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Video',
          extensions: SUPPORTED_VIDEO_EXTENSIONS,
        }]
      });

      if (selected && Array.isArray(selected) && selected.length > 0) {
        await addFiles(selected);
        triggerDropSuccess();
      } else if (selected && typeof selected === 'string') {
        await addFiles([selected]);
        triggerDropSuccess();
      }
    } catch (error) {
      console.error('Failed to select files:', error);
    }
  };

  // Listen for Tauri native file drop events
  useEffect(() => {
    let isMounted = true;
    let unlistenFn: UnlistenFn | undefined;

    const setupFileDrop = async () => {
      try {
        const unlisten = await appWindow.onFileDropEvent(async (event) => {
          if (!isMounted) return;

          // If a file is being dragged out from Szhimatar, ignore self-drop and self-hover events
          if (isSelfDragActive()) {
            if (event.payload.type === 'cancel' || event.payload.type === 'drop') {
              setIsDragging(false);
            }
            return;
          }

          if (event.payload.type === 'hover') {
            setIsDragging(true);
          } else if (event.payload.type === 'drop') {
            setIsDragging(false);
            const droppedPaths = event.payload.paths;
            const validFiles = droppedPaths.filter((filePath) =>
              VIDEO_EXT_REGEX.test(filePath)
            );
            if (validFiles.length > 0) {
              await addFiles(validFiles);
              triggerDropSuccess();
            } else if (droppedPaths.length > 0) {
              triggerDropError();
            }
          } else if (event.payload.type === 'cancel') {
            setIsDragging(false);
          }
        });

        if (isMounted) {
          unlistenFn = unlisten;
        } else {
          unlisten();
        }
      } catch (error) {
        console.error('[MainWindow] Failed to register file drop listener:', error);
      }
    };

    setupFileDrop();

    return () => {
      isMounted = false;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [addFiles, triggerDropError, triggerDropSuccess]);

  // Prevent default browser drag/drop behavior on window (prevents navigating away) and track cursor
  useEffect(() => {
    const preventDragDropDefaults = (e: DragEvent) => {
      e.preventDefault();
      if (e.clientX || e.clientY) {
        lastPointerPosRef.current = { clientX: e.clientX, clientY: e.clientY };
      }
    };

    window.addEventListener('dragover', preventDragDropDefaults);
    window.addEventListener('drop', preventDragDropDefaults);

    return () => {
      window.removeEventListener('dragover', preventDragDropDefaults);
      window.removeEventListener('drop', preventDragDropDefaults);
    };
  }, []);

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

  const handleDownloadMedia = async () => {
    const trimmedUrl = downloadUrl.trim();
    if (!trimmedUrl) {
      return;
    }

    const selectedFormat =
      downloadFormats.find((item) => item.label === selectedDownloadFormat) ||
      downloadFormats[0] ||
      DEFAULT_DOWNLOAD_FORMATS[0];
    const savePath = mainScreenSettings.customOutputPath.trim();

    try {
      await startDownload(
        trimmedUrl,
        selectedFormat.quality,
        selectedFormat.format,
        selectedFormat.label,
        savePath,
        parsedVideoTitle || undefined
      );
      setDownloadUrl('');
      setParsedVideoTitle('');
    } catch (error) {
      console.error('[MainWindow] Download failed:', error);
    }
  };

  const handleStart = async () => {
    try {
      await start();
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

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files)
      .map(f => (f as File & { path?: string }).path)
      .filter((p): p is string => typeof p === 'string' && VIDEO_EXT_REGEX.test(p));
      
    if (files.length > 0) {
      await addFiles(files);
      triggerDropSuccess();
    } else if (e.dataTransfer.files.length > 0) {
      triggerDropError();
    }
  }, [addFiles, triggerDropError, triggerDropSuccess]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only fire when leaving the element itself, not child elements
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);


  const handleRemoveJob = (jobId: string) => {
    removeJob(jobId);
  };



  const handleClearCompleted = () => {
    clearCompleted();
    clearCompletedDownloads();
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
  };

  const handleShowInExplorer = async (filePath: string) => {
    try {
      await invoke('show_in_explorer', { filePath });
    } catch (error) {
      console.error('Failed to show file in explorer:', error);
      // Optionally show a notification to user
    }
  };

  const formatTrimTime = (seconds: number): string => {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${minutes}:${secs.toFixed(1).padStart(4, '0')}`;
  };

  const formatDurationCompact = (seconds: number): string => {
    const safeSeconds = Math.max(0, seconds);
    if (safeSeconds < 60) {
      return `${safeSeconds.toFixed(1)}s`;
    }
    const minutes = Math.floor(safeSeconds / 60);
    const secs = safeSeconds - minutes * 60;
    return `${minutes}m ${secs.toFixed(1)}s`;
  };

  const needsTopPreviewSpace = Boolean(
    trimFramePreview && jobs.length > 0 && trimFramePreview.jobId === jobs[0].id,
  );

  const hideTrimFramePreview = useCallback((delayMs: number = 450) => {
    if (trimPreviewHideRef.current) {
      clearTimeout(trimPreviewHideRef.current);
    }
    trimPreviewHideRef.current = setTimeout(() => {
      setTrimFramePreview(null);
    }, delayMs);
  }, []);

  const requestTrimFramePreview = useCallback((
    jobId: string,
    inputPath: string,
    timeSec: number,
    leftPercent: number,
    handle: TrimHandleType,
  ) => {
    if (!inputPath) return;

    if (trimPreviewHideRef.current) {
      clearTimeout(trimPreviewHideRef.current);
    }

    const roundedTimeSec = Math.max(0, Math.round(timeSec * 2) / 2);
    const cacheKey = `${inputPath}|${roundedTimeSec.toFixed(1)}`;
    const cachedFrame = trimPreviewCacheRef.current.get(cacheKey) || null;

    setTrimFramePreview({
      jobId,
      handle,
      timeSec: roundedTimeSec,
      leftPercent,
      imageDataUrl: cachedFrame,
      loading: !cachedFrame,
    });

    if (cachedFrame) {
      return;
    }

    if (trimPreviewDebounceRef.current) {
      clearTimeout(trimPreviewDebounceRef.current);
    }

    trimPreviewDebounceRef.current = setTimeout(async () => {
      const requestId = ++trimPreviewRequestRef.current;

      try {
        const frame = await invoke<string>('get_preview_frame', {
          inputPath,
          timeSeconds: roundedTimeSec,
          settings: {
            codec: '',
            crf: '23',
            fps: '',
            resolution: '',
            filters: [],
            resampling_enabled: false,
            resampling_intensity: 0,
          },
        });

        if (requestId !== trimPreviewRequestRef.current) {
          return;
        }

        const dataUrl = `data:image/jpeg;base64,${frame}`;
        trimPreviewCacheRef.current.set(cacheKey, dataUrl);

        setTrimFramePreview((prev) => {
          if (!prev) return prev;
          if (prev.jobId !== jobId || prev.handle !== handle) return prev;
          if (Math.abs(prev.timeSec - roundedTimeSec) > 0.001) return prev;
          return {
            ...prev,
            imageDataUrl: dataUrl,
            loading: false,
          };
        });
      } catch (error) {
        console.warn('[MainWindow] Failed to load trim frame preview:', error);
        if (requestId !== trimPreviewRequestRef.current) {
          return;
        }
        setTrimFramePreview((prev) => {
          if (!prev) return prev;
          if (prev.jobId !== jobId || prev.handle !== handle) return prev;
          if (Math.abs(prev.timeSec - roundedTimeSec) > 0.001) return prev;
          return {
            ...prev,
            loading: false,
          };
        });
      }
    }, 80);
  }, []);

  useEffect(() => {
    return () => {
      if (trimPreviewDebounceRef.current) {
        clearTimeout(trimPreviewDebounceRef.current);
      }
      if (trimPreviewHideRef.current) {
        clearTimeout(trimPreviewHideRef.current);
      }
    };
  }, []);

  return ( 
    <div className="main-window fade-in" style={{ color: theme.colors.text }}>
      <header
        className={`header ${isHeaderCollapsed ? 'header--collapsed' : ''}`}
        style={{ borderColor: isHeaderCollapsed ? 'transparent' : theme.colors.border }}
        data-tauri-drag-region
      >
        <div className="header-row" data-tauri-drag-region>
          {/* Left group: Video, Audio */}
          <div className={`header-group header-group--left ${isHeaderCollapsed ? 'is-hidden' : ''}`} data-tauri-drag-region>
            <button
              className="header-nav-btn"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate('video');
              }}
              style={{ background: theme.colors.primary, color: '#fff' }}
            >
              <Film size={18} strokeWidth={1.5} /> <span>{t('video.title')}</span>
            </button>
            <button
              className="header-nav-btn"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate('audio');
              }}
              style={{ background: theme.colors.primary, color: '#fff' }}
            >
              <Volume2 size={18} strokeWidth={1.5} /> <span>{t('audio.title')}</span>
            </button>
          </div>

          {/* Center group: Dynamic Island morphing toggle button */}
          <div className="header-group header-group--center" data-tauri-drag-region>
            <button
              type="button"
              className={`dynamic-island ${isHeaderCollapsed ? 'dynamic-island--collapsed' : 'dynamic-island--expanded'}`}
              onClick={(e) => {
                e.stopPropagation();
                handleToggleHeaderCollapsed(!isHeaderCollapsed);
              }}
              title={isHeaderCollapsed ? (t('header.expand') || 'Развернуть шапку') : (t('header.collapse') || 'Свернуть шапку')}
              aria-label={isHeaderCollapsed ? (t('header.expand') || 'Развернуть шапку') : (t('header.collapse') || 'Свернуть шапку')}
            >
              <AnimatePresence mode="wait" initial={false}>
                {isHeaderCollapsed ? (
                  <motion.div
                    key="island-content-collapsed"
                    className="dynamic-island-inner"
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.94 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <span className="dynamic-island-title">Szhimatar</span>
                    <ChevronDown size={15} strokeWidth={2.4} className="dynamic-island-icon" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="island-content-expanded"
                    className="dynamic-island-inner"
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.94 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <span className="dynamic-island-title">Szhimatar</span>
                    <ChevronUp size={15} strokeWidth={2.4} className="dynamic-island-icon" />
                  </motion.div>
                )}
              </AnimatePresence>
            </button>
          </div>

          {/* Right group: Statistics, Settings */}
          <div className={`header-group header-group--right ${isHeaderCollapsed ? 'is-hidden' : ''}`} data-tauri-drag-region>
            <button
              className="header-nav-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowStats(true);
              }}
              style={{ background: theme.colors.primary, color: '#fff' }}
            >
              <BarChart3 size={18} strokeWidth={1.5} /> <span>{t('stats.title') || 'Statistics'}</span>
            </button>
            <button 
              className="header-nav-btn"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate('general');
              }} 
              style={{ 
                background: updateAvailable ? theme.colors.success : theme.colors.secondary, 
                color: '#fff',
                animation: updateAvailable ? 'pulse 2s infinite' : 'none',
              }}
            >
              {updateAvailable ? <Sparkles size={18} strokeWidth={1.5} /> : <Settings size={18} strokeWidth={1.5} />} <span>{updateAvailable ? t('settings.update_available') : t('settings.title')}</span>
            </button>
          </div>
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

      <div className={`content ${isHeaderCollapsed ? 'content--header-collapsed' : ''}`}>

        {/* ══════════════════════════════════════════════════════
            UNIFIED ACTION BAR — разнесенные края (space-between)
            ══════════════════════════════════════════════════════ */}
        <div className="action-bar">

          {/* ── Блок пресетов (left) ── */}
          <div className="action-bar-left">
            <Suspense fallback={null}>
              <PresetManager
                currentVideoSettings={videoSettings}
                currentAudioSettings={audioSettings}
                currentMainScreenSettings={mainScreenSettings}
                currentWatermarkSettings={watermarkSettings}
                onApplyPreset={handleApplyPreset}
                selectedPresetName={selectedPresetName}
                setSelectedPresetName={setSelectedPresetName}
              />
            </Suspense>
          </div>

          {/* ── Блок папки сохранения (right) ── */}
          <div className="action-bar-right">
            <button
              className="action-bar-btn action-bar-btn--primary"
              onClick={handleSelectOutputFolder}
              disabled={mainScreenSettings.saveInSourceDirectory}
              style={{
                background: theme.colors.primary,
                color: '#fff',
                flexShrink: 0,
                opacity: mainScreenSettings.saveInSourceDirectory ? 0.5 : 1,
                cursor: mainScreenSettings.saveInSourceDirectory ? 'not-allowed' : 'pointer',
              }}
              title={mainScreenSettings.customOutputPath || t('main.outputFolder')}
            >
              <HardDrive size={15} strokeWidth={1.8} />
              <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {mainScreenSettings.customOutputPath
                  ? mainScreenSettings.customOutputPath.split(/[\\\/]/).pop()
                  : t('main.outputFolder')}
              </span>
            </button>

            <motion.button
              className="action-bar-btn action-bar-btn--icon"
              type="button"
              aria-pressed={mainScreenSettings.saveInSourceDirectory}
              onClick={handleToggleSaveInSourceDirectory}
              title={t('main.saveInSourceDirectory')}
              initial={false}
              animate={{
                backgroundColor: mainScreenSettings.saveInSourceDirectory ? theme.colors.primary : 'rgba(var(--theme-bg-rgb), 0.22)',
                color: mainScreenSettings.saveInSourceDirectory ? '#fff' : theme.colors.textSecondary,
              }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              style={{ flexShrink: 0, border: `1px solid ${theme.colors.border}` }}
            >
              <FolderSyncIcon color={mainScreenSettings.saveInSourceDirectory ? '#fff' : theme.colors.text} />
            </motion.button>
          </div>

        </div>
        {/* ══════════════════════════════════════════════════════ */}

        {/* ── EMPTY STATE (shown when no jobs and no downloads) ── */}
        {jobs.length === 0 && downloadQueue.length === 0 ? (
          <div
            ref={emptyStateRef}
            className={`empty-state${isDragging ? ' drag-over' : ''}${isDropError ? ' shake-error' : ''}${isDropSuccess ? ' drop-success' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={(e) => {
              lastPointerPosRef.current = { clientX: e.clientX, clientY: e.clientY };
              handleSelectFiles();
            }}
          >
            {isDropSuccess && (
              <div
                className="water-ripple-container"
                style={{
                  '--ripple-x': ripplePos ? `${ripplePos.x}px` : '50%',
                  '--ripple-y': ripplePos ? `${ripplePos.y}px` : '50%',
                } as React.CSSProperties}
              >
                <span className="water-ripple-wave" />
                <span className="water-ripple-wave delay" />
              </div>
            )}
            <div className="empty-state-icon">
              <Folder size={48} strokeWidth={1} />
            </div>
            <p className="empty-state-title">{t('main.selectFiles')}</p>
            <p className="empty-state-subtitle" style={{ color: theme.colors.textSecondary }}>
              {t('main.dropFilesHere')}
            </p>

            <div className="empty-state-divider" style={{ color: theme.colors.textSecondary }}>
              <span className="empty-state-line" style={{ background: theme.colors.border }} />
              <span>{t('common.or')}</span>
              <span className="empty-state-line" style={{ background: theme.colors.border }} />
            </div>

            {/* URL download pill */}
            <div className="empty-state-url-row" onClick={e => e.stopPropagation()}>
              <input
                className="action-bar-input"
                type="text"
                value={downloadUrl}
                onChange={(e) => setDownloadUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && downloadUrl.trim()) handleDownloadMedia(); }}
                placeholder={t('download.urlPlaceholder')}
                style={{ color: theme.colors.text }}
              />
              <span className="url-pill-sep" style={{ background: theme.colors.border }} />
              <div className="action-bar-format-wrap" style={{ background: theme.colors.surface }}>
                <select
                  className="action-bar-format-select"
                  value={selectedDownloadFormat}
                  onChange={(e) => setSelectedDownloadFormat(e.target.value)}
                  style={{ color: theme.colors.text }}
                >
                  {downloadFormats.map((item) => (
                    <option key={item.label} value={item.label} style={{ backgroundColor: theme.colors.surface, color: theme.colors.text }}>
                      {item.label}
                      {item.height ? ` • ${formatDownloadHeight(item.height)}` : ''}
                      {item.filesize ? ` • ${formatDownloadBytes(item.filesize)}` : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} strokeWidth={2} className="action-bar-format-caret" style={{ color: theme.colors.textSecondary }} />
              </div>
              <button
                className="action-bar-btn action-bar-btn--success"
                onClick={handleDownloadMedia}
                disabled={!downloadUrl.trim()}
                style={{ background: theme.colors.success, color: '#fff', flexShrink: 0 }}
              >
                {isLoadingDownloadFormats
                  ? <Loader2 size={15} strokeWidth={2} className="download-spinner" />
                  : <Download size={15} strokeWidth={2} />}
                <span>{t('download.downloadButton')}</span>
              </button>
            </div>
          </div>
        ) : (
          /* ── ACTIVE STATE ── */
          <div className="queue-section">
            <div className="queue-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>{t('main.queue')} ({jobs.length + downloadQueue.length})</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {/* Quick-add buttons */}
                <button
                  className="queue-add-btn"
                  onClick={handleSelectFiles}
                  title={t('main.selectFiles')}
                  style={{ color: theme.colors.text, borderColor: theme.colors.border, background: 'rgba(var(--theme-bg-rgb), 0.2)' }}
                >
                  <Folder size={14} strokeWidth={1.8} />
                  <span>{t('queue.addFile')}</span>
                </button>
                <button
                  className="queue-add-btn"
                  onClick={() => setShowUrlInput(v => !v)}
                  title={t('queue.addLinkTooltip')}
                  style={{ color: theme.colors.text, borderColor: theme.colors.border, background: showUrlInput ? `${theme.colors.primary}22` : 'rgba(var(--theme-bg-rgb), 0.2)' }}
                >
                  <Download size={14} strokeWidth={1.8} />
                  <span>{t('queue.addLink')}</span>
                </button>
                {/* Stats */}
                <div className="queue-stats" style={{ fontSize: '0.85rem', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 8 }}>
                  {(completedJobs + downloadQueue.filter(i => i.status === 'completed').length) > 0 && (
                    <span style={{ color: theme.colors.success, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Check size={14} strokeWidth={2} /> {completedJobs + downloadQueue.filter(i => i.status === 'completed').length}
                    </span>
                  )}
                  {errorJobs > 0 && <span style={{ color: theme.colors.error, display: 'flex', alignItems: 'center', gap: '4px' }}><X size={14} strokeWidth={2} /> {errorJobs}</span>}
                  {pendingJobs > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={14} strokeWidth={2} /> {pendingJobs}</span>}
                  {downloadQueue.some(i => i.status === 'downloading') && (
                    <span style={{ color: theme.colors.primary, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Download size={14} strokeWidth={2} /> {downloadQueue.filter(i => i.status === 'downloading').length}
                    </span>
                  )}
                  {(completedJobs + downloadQueue.filter(i => i.status === 'completed').length) > 0 && (
                    <button
                      onClick={handleClearCompleted}
                      style={{ marginLeft: '4px', padding: '2px 8px', fontSize: '0.8rem', background: 'rgba(var(--theme-bg-rgb), 0.2)', backdropFilter: 'blur(8px)', color: theme.colors.text, border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      {t('queue.clearCompleted')}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Collapsible URL input row */}
            <AnimatePresence>
              {showUrlInput && (
                <motion.div
                  className="queue-url-row"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <input
                    className="action-bar-input"
                    type="text"
                    value={downloadUrl}
                    onChange={(e) => setDownloadUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && downloadUrl.trim()) { handleDownloadMedia(); setShowUrlInput(false); } }}
                    placeholder={t('download.urlPlaceholder')}
                    autoFocus
                    style={{ color: theme.colors.text, background: theme.colors.surface, borderColor: theme.colors.border }}
                  />
                  <div className="action-bar-format-wrap" style={{ borderColor: theme.colors.border, background: theme.colors.surface }}>
                    <select
                      className="action-bar-format-select"
                      value={selectedDownloadFormat}
                      onChange={(e) => setSelectedDownloadFormat(e.target.value)}
                      style={{ color: theme.colors.text }}
                    >
                      {downloadFormats.map((item) => (
                        <option key={item.label} value={item.label} style={{ backgroundColor: theme.colors.surface, color: theme.colors.text }}>
                          {item.label}
                          {item.height ? ` • ${formatDownloadHeight(item.height)}` : ''}
                          {item.filesize ? ` • ${formatDownloadBytes(item.filesize)}` : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} strokeWidth={2} className="action-bar-format-caret" style={{ color: theme.colors.textSecondary }} />
                  </div>
                  <button
                    className="action-bar-btn action-bar-btn--success"
                    onClick={() => { handleDownloadMedia(); setShowUrlInput(false); }}
                    disabled={!downloadUrl.trim()}
                    style={{ background: theme.colors.success, color: '#fff', flexShrink: 0 }}
                  >
                    {isLoadingDownloadFormats
                      ? <Loader2 size={15} strokeWidth={2} className="download-spinner" />
                      : <Download size={15} strokeWidth={2} />}
                    <span>{t('download.downloadButton')}</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div
              ref={queueListRef}
              className={`queue-list ${needsTopPreviewSpace ? 'has-top-preview-room' : ''}${isDropError ? ' shake-error' : ''}${isDropSuccess ? ' drop-success' : ''}`}
              style={{ borderColor: theme.colors.border }}
            >
              {isDropSuccess && (
                <div
                  className="water-ripple-container"
                  style={{
                    '--ripple-x': ripplePos ? `${ripplePos.x}px` : '50%',
                    '--ripple-y': ripplePos ? `${ripplePos.y}px` : '50%',
                  } as React.CSSProperties}
                >
                  <span className="water-ripple-wave" />
                  <span className="water-ripple-wave delay" />
                </div>
              )}
              <>
                <AnimatePresence initial={false}>
                  {downloadQueue.map((item) => (
                    <DownloadJobItem
                      key={item.id}
                      item={item}
                      theme={theme}
                      t={t}
                      onShowInExplorer={handleShowInExplorer}
                      onRemoveJob={removeDownloadJob}
                      onStopJob={stopDownload}
                    />
                  ))}
                </AnimatePresence>

                {jobs.length > 0 && downloadQueue.length > 0 && (
                  <div style={{ height: '1px', background: theme.colors.border, opacity: 0.5, margin: '6px 0' }} />
                )}

                {jobs.map((item) => (
                  <RenderJobItem
                    key={item.id}
                    job={item}
                    theme={theme}
                    t={t}
                    onAddToQueue={addToQueue}
                    onShowInExplorer={handleShowInExplorer}
                    onRemoveJob={handleRemoveJob}
                    onStopJob={stopJob}
                    onUpdateJobTrim={updateJobTrim}
                    onRequestTrimFramePreview={requestTrimFramePreview}
                    onHideTrimFramePreview={hideTrimFramePreview}
                    trimFramePreview={trimFramePreview}
                    formatTrimTime={formatTrimTime}
                    formatDurationCompact={formatDurationCompact}
                    getStatusDisplay={getStatusDisplay}
                  />
                ))}
              </>
            </div>
          </div>
        )}

        {/* ── ACTIVE QUEUE DRAG OVERLAY ── */}
        <AnimatePresence>
          {isDragging && (jobs.length > 0 || downloadQueue.length > 0) && (
            <motion.div
              className="queue-drop-overlay"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              style={{
                borderColor: theme.colors.primary,
              }}
            >
              <div
                className="queue-drop-overlay-icon"
                style={{
                  color: theme.colors.primary,
                  backgroundColor: `${theme.colors.primary}20`,
                }}
              >
                <Folder size={36} strokeWidth={1.8} />
              </div>
              <p className="queue-drop-overlay-title" style={{ color: theme.colors.text }}>
                {t('main.dropFilesHere')}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="controls">
          <motion.button
            className="ctrl-btn"
            onClick={handleStart}
            disabled={isProcessing || jobs.length === 0 || pendingJobs === 0}
            style={{ background: theme.colors.success, color: '#fff' }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          >
            <Play size={17} strokeWidth={1.8} /> {t('main.start')}
          </motion.button>
          <motion.button
            className="ctrl-btn"
            onClick={handlePause}
            disabled={!isProcessing}
            style={{ background: theme.colors.warning, color: '#fff' }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          >
            {isPaused ? <Play size={17} strokeWidth={1.8} /> : <Pause size={17} strokeWidth={1.8} />} {t('main.pause')}
          </motion.button>
          <motion.button
            className="ctrl-btn"
            onClick={handleStop}
            disabled={!isProcessing}
            style={{ background: theme.colors.error, color: '#fff' }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          >
            <Square size={17} strokeWidth={1.8} /> {t('main.stop')}
          </motion.button>
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
              <Suspense fallback={null}>
                <StatisticsPanel onClose={closeStats} />
              </Suspense>
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
          resolution: videoSettings.resolution,            aspectRatioAuto: videoSettings.aspectRatioAuto,          filters: videoSettings.filters.filter(f => f.enabled).map(f => f.name),
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
