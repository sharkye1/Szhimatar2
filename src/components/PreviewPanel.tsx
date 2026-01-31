import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/tauri';
import { motion } from 'framer-motion';
import { useLanguage } from '../contexts/LanguageContext';
import './PreviewPanel.css';

// Simple SVG icons
const EyeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

const PlayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>
);

const ImageIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
);

const RefreshIcon = ({ className }: { className?: string }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10"/>
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
  </svg>
);

const LoaderIcon = ({ size = 32 }: { size?: number }) => (
  <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="2" x2="12" y2="6"/>
    <line x1="12" y1="18" x2="12" y2="22"/>
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
    <line x1="2" y1="12" x2="6" y2="12"/>
    <line x1="18" y1="12" x2="22" y2="12"/>
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
  </svg>
);

const ChevronLeftIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);

interface PreviewSettings {
  codec: string;
  crf: string;
  fps: string;
  resolution: string;
  filters: string[];
  resampling_enabled: boolean;
  resampling_intensity: number;
  // NEW: Sync with final render parameters
  bitrate?: string;        // e.g. "2.6" for 2.6M
  preset?: string;         // e.g. "slow", "medium", "p7"
  prefer_gpu?: boolean;    // Use NVENC if available
}

interface VideoPreviewInfo {
  duration: number;
  width: number;
  height: number;
}

interface PreviewPanelProps {
  inputPath?: string;       // Legacy prop name
  videoPath?: string;       // New prop name (alias for inputPath)
  settings?: PreviewSettings;
  videoSettings?: {         // Alternative settings format from VideoSettings page
    codec: string;
    crf: string;
    fps: string;
    resolution: string;
    bitrate?: string;       // Bitrate in Mbps (e.g. "2.6")
    preset?: string;        // Encoding preset
    filters: { name: string; enabled: boolean }[];
    resamplingEnabled?: boolean;
    resamplingIntensity?: number;
  };
  preferGpu?: boolean;      // Use GPU encoding for preview
  isVisible: boolean;
  onToggleVisibility?: () => void;  // Legacy callback
  onToggle?: () => void;            // New callback (alias)
  embedded?: boolean;               // If true, render inline instead of fixed position
}

const PreviewPanel: React.FC<PreviewPanelProps> = ({
  inputPath,
  videoPath,
  settings,
  videoSettings,
  preferGpu = false,
  isVisible,
  onToggleVisibility,
  onToggle,
  embedded = false,
}) => {
  const { t } = useLanguage();
  
  // Normalize props
  const filePath = videoPath || inputPath || '';
  const toggleVisibility = onToggle || onToggleVisibility || (() => {});
  
  // Convert videoSettings to PreviewSettings format if needed
  // CRITICAL: Include ALL encoding parameters for honest preview
  const previewSettings: PreviewSettings = settings || {
    codec: videoSettings?.codec || 'h264',
    crf: videoSettings?.crf || '23',
    fps: videoSettings?.fps || '30',
    resolution: videoSettings?.resolution || '1920x1080',
    filters: videoSettings?.filters?.filter(f => f.enabled).map(f => f.name) || [],
    resampling_enabled: videoSettings?.resamplingEnabled || false,
    resampling_intensity: videoSettings?.resamplingIntensity || 0,
    // NEW: Pass encoding parameters for matching final render quality
    bitrate: videoSettings?.bitrate || undefined,
    preset: videoSettings?.preset || 'medium',
    prefer_gpu: preferGpu,
  };
  
  // Check for low bitrate warning (90fps + 1080p + < 6M bitrate)
  const showBitrateWarning = (() => {
    const fps = parseInt(previewSettings.fps) || 30;
    const resolution = previewSettings.resolution;
    const bitrate = parseFloat(previewSettings.bitrate || '0');
    const is1080pOrHigher = resolution.includes('1080') || resolution.includes('1440') || resolution.includes('2160');
    return fps >= 60 && is1080pOrHigher && bitrate > 0 && bitrate < 6;
  })();
  
  const [mode, setMode] = useState<'frame' | 'video'>('frame');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originalFrame, setOriginalFrame] = useState<string | null>(null);
  const [processedFrame, setProcessedFrame] = useState<string | null>(null);
  const [previewVideoPath, setPreviewVideoPath] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoPreviewInfo | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [dividerPosition, setDividerPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [videoErrorCount, setVideoErrorCount] = useState(0);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // CRITICAL: Track the fingerprint of the last EXECUTED render to break infinite loop
  const lastExecutedFingerprintRef = useRef<string>('');
  const isGeneratingRef = useRef<boolean>(false);

  // Create stable fingerprint from current settings (does NOT include isLoading/error state)
  const createSettingsFingerprint = useCallback(() => {
    return JSON.stringify({
      codec: previewSettings.codec,
      crf: previewSettings.crf,
      fps: previewSettings.fps,
      resolution: previewSettings.resolution,
      filters: previewSettings.filters,
      resampling_enabled: previewSettings.resampling_enabled,
      resampling_intensity: previewSettings.resampling_intensity,
      bitrate: previewSettings.bitrate,
      preset: previewSettings.preset,
      prefer_gpu: previewSettings.prefer_gpu,
      mode: mode,
      time: currentTime,
      filePath: filePath,
    });
  }, [previewSettings.codec, previewSettings.crf, previewSettings.fps,
      previewSettings.resolution, previewSettings.filters,
      previewSettings.resampling_enabled, previewSettings.resampling_intensity,
      previewSettings.bitrate, previewSettings.preset, previewSettings.prefer_gpu,
      mode, currentTime, filePath]);

  // Cleanup base64 URLs on unmount or when changing frames to prevent memory leaks
  useEffect(() => {
    return () => {
      // Cleanup is automatic for base64 data URLs (no blob to revoke)
      // But we clear state to help GC
      setOriginalFrame(null);
      setProcessedFrame(null);
      setPreviewVideoPath(null);
    };
  }, []); 

  // Clear old frames when switching modes to free memory
  useEffect(() => {
    if (mode === 'frame') {
      setPreviewVideoPath(null);
    } else {
      setOriginalFrame(null);
      setProcessedFrame(null);
    }
  }, [mode]);

  // Keyframe positions (0%, 50%, 90%)
  const keyframes = videoInfo 
    ? [0, videoInfo.duration * 0.5, videoInfo.duration * 0.9]
    : [0, 0, 0];

  // Load video info when input path changes
  useEffect(() => {
    if (!filePath) {
      setVideoInfo(null);
      setOriginalFrame(null);
      setProcessedFrame(null);
      return;
    }

    const loadVideoInfo = async () => {
      try {
        const info = await invoke<VideoPreviewInfo>('get_video_info_for_preview', {
          inputPath: filePath,
        });
        setVideoInfo(info);
        setCurrentTime(0);
      } catch (err) {
        console.error('Failed to get video info:', err);
        setError(String(err));
      }
    };

    loadVideoInfo();
  }, [filePath]);

  // Generate preview - called by debounced effect or manually
  const generatePreview = useCallback(async (forceRender = false) => {
    if (!filePath || !videoInfo) return;
    
    // Prevent concurrent renders
    if (isGeneratingRef.current && !forceRender) {
      console.log('[Preview] Already generating, skipping');
      return;
    }

    // Create fingerprint for comparison
    const fingerprint = createSettingsFingerprint();

    // CRITICAL: Skip if fingerprint matches last executed render (unless forced)
    if (!forceRender && lastExecutedFingerprintRef.current === fingerprint) {
      console.log('[Preview] Skipping - fingerprint unchanged:', fingerprint.substring(0, 80));
      return;
    }

    console.log('[Preview] Starting render with fingerprint:', fingerprint.substring(0, 80));
    
    isGeneratingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      if (mode === 'frame') {
        // Get original frame (no processing)
        const original = await invoke<string>('get_preview_frame', {
          inputPath: filePath,
          timeSeconds: currentTime,
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
        setOriginalFrame(`data:image/jpeg;base64,${original}`);

        // Get processed frame with FULL settings
        const processed = await invoke<string>('get_preview_frame', {
          inputPath: filePath,
          timeSeconds: currentTime,
          settings: previewSettings,
        });
        setProcessedFrame(`data:image/jpeg;base64,${processed}`);
      } else {
        // Video mode - uses IDENTICAL encoding parameters as final render
        // Log exact settings being sent to Rust/FFmpeg
        console.log('[PREVIEW CMD] Sending to FFmpeg:', JSON.stringify(previewSettings, null, 2));
        
        const videoPath = await invoke<string>('get_preview_video', {
          inputPath: filePath,
          timeSeconds: currentTime,
          duration: 3.0,
          settings: previewSettings,
        });
        
        // Validate file exists and has content
        if (!videoPath || videoPath.trim() === '') {
          throw new Error('Preview generation failed: empty path');
        }
        
        // Small delay to ensure file is fully written and OS releases lock
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Convert file path to asset URL for Tauri WebView
        // NOTE: Don't use query params with asset:// - they cause ERR_CONNECTION_REFUSED
        const videoUrl = convertFileSrc(videoPath);
        console.log('[Preview] Setting video URL:', videoUrl);
        
        // Reset error count on new video
        setVideoErrorCount(0);
        setPreviewVideoPath(videoUrl);
      }
      
      // CRITICAL: Save fingerprint AFTER successful render
      lastExecutedFingerprintRef.current = fingerprint;
      console.log('[Preview] Render complete, saved fingerprint');
      
    } catch (err) {
      console.error('Preview generation failed:', err);
      setError(String(err));
    } finally {
      isGeneratingRef.current = false;
      setIsLoading(false);
    }
  }, [filePath, currentTime, mode, videoInfo, createSettingsFingerprint, previewSettings]);

  // Debounced preview generation on settings change
  // CRITICAL: Check fingerprint BEFORE setting up timer to break infinite loop
  useEffect(() => {
    if (!isVisible || !filePath || !videoInfo) return;

    // FIRST: Create fingerprint and check if it matches last executed
    const fingerprint = createSettingsFingerprint();
    if (lastExecutedFingerprintRef.current === fingerprint) {
      // Don't log every time - this is expected behavior
      return; // Don't even set up debounce timer
    }

    // Log what changed for debugging
    console.log('[Debounce] Resetting timer due to fingerprint change');
    console.log('[Debounce] Old:', lastExecutedFingerprintRef.current.substring(0, 60) + '...');
    console.log('[Debounce] New:', fingerprint.substring(0, 60) + '...');
    
    // FIRST clear any existing timer
    if (debounceRef.current) {
      console.log('[Debounce] Clearing previous timer');
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    // THEN set new timer
    console.log('[Debounce] Starting 5-second timer...');
    debounceRef.current = setTimeout(() => {
      console.log('[Debounce] Timer fired! Generating preview now.');
      generatePreview();
    }, 5000); // 5-second debounce

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [isVisible, filePath, videoInfo, createSettingsFingerprint, generatePreview]);

  // Generate preview immediately when time changes (keyframe navigation)
  useEffect(() => {
    if (!isVisible || !filePath || !videoInfo) return;
    
    // Cancel previous debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Time change always triggers immediate render
    generatePreview();
  }, [currentTime, isVisible, filePath, videoInfo, generatePreview]);

  // Divider drag handlers
  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(10, Math.min(90, (x / rect.width) * 100));
      setDividerPosition(percentage);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Format time display
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // In embedded mode, don't show toggle button when hidden
  if (!isVisible) {
    if (embedded) {
      return null; // VideoSettings handles the toggle button
    }
    return (
      <motion.button
        className="preview-toggle-btn"
        onClick={toggleVisibility}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title={t('preview.show') || 'Show Preview'}
      >
        <EyeIcon />
      </motion.button>
    );
  }

  return (
    <motion.div
      className={`preview-panel ${embedded ? 'preview-panel-embedded' : ''}`}
      initial={{ opacity: 0, x: embedded ? 0 : 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: embedded ? 0 : 20 }}
    >
      {/* Header */}
      <div className="preview-header">
        <h3>{t('preview.title') || 'Live Preview'}</h3>
        <div className="preview-header-actions">
          <button
            className={`preview-mode-btn ${mode === 'frame' ? 'active' : ''}`}
            onClick={() => setMode('frame')}
            title={t('preview.frameMode') || 'Frame Mode'}
          >
            <ImageIcon size={16} />
          </button>
          <button
            className={`preview-mode-btn ${mode === 'video' ? 'active' : ''}`}
            onClick={() => setMode('video')}
            title={t('preview.videoMode') || 'Video Mode'}
          >
            <PlayIcon />
          </button>
          <button
            className="preview-mode-btn"
            onClick={toggleVisibility}
            title={t('preview.hide') || 'Hide Preview'}
          >
            <EyeOffIcon />
          </button>
        </div>
      </div>

      {/* Low Bitrate Warning */}
      {showBitrateWarning && (
        <div className="preview-warning">
          ⚠️ {t('preview.lowBitrateWarning') || `Low bitrate (${previewSettings.bitrate}M) for ${previewSettings.fps}fps @ ${previewSettings.resolution}. Recommend ≥6M for NVENC to avoid artifacts.`}
        </div>
      )}

      {/* Content */}
      <div className="preview-content">
        {!filePath ? (
          <div className="preview-placeholder">
            <ImageIcon size={48} />
            <p>{t('preview.selectVideo') || 'Select a video to preview'}</p>
          </div>
        ) : isLoading ? (
          <div className="preview-loading">
            <LoaderIcon size={32} />
            <p>{t('preview.generating') || 'Generating preview...'}</p>
          </div>
        ) : error ? (
          <div className="preview-error">
            <p>{error}</p>
            <button onClick={() => generatePreview(true)}>
              <RefreshIcon />
              {t('preview.retry') || 'Retry'}
            </button>
          </div>
        ) : mode === 'frame' && originalFrame && processedFrame ? (
          <div 
            className="preview-split-view" 
            ref={containerRef}
          >
            {/* Original Layer (Before) - Full Width Background */}
            <div className="preview-original">
              <img src={originalFrame} alt="Original" draggable={false} />
              <span className="preview-label">{t('preview.original') || 'Original'}</span>
            </div>

            {/* Processed Layer (After) - Clipped Overlay using clip-path */}
            <div 
              className="preview-processed"
              style={{ 
                clipPath: `polygon(${dividerPosition}% 0, 100% 0, 100% 100%, ${dividerPosition}% 100%)` 
              }}
            >
              <img src={processedFrame} alt="Processed" draggable={false} />
              <span className="preview-label">{t('preview.processed') || 'Processed'}</span>
            </div>

            {/* Draggable divider */}
            <div
              className={`preview-divider ${isDragging ? 'dragging' : ''}`}
              style={{ left: `${dividerPosition}%` }}
              onMouseDown={handleDividerMouseDown}
            >
              <div className="preview-divider-handle">
                <ChevronLeftIcon />
                <ChevronRightIcon />
              </div>
            </div>
          </div>
        ) : mode === 'video' && previewVideoPath ? (
          <div className="preview-video-container">
            <video
              ref={videoRef}
              src={previewVideoPath}
              controls
              loop
              autoPlay
              muted
              onError={(e) => {
                const newCount = videoErrorCount + 1;
                setVideoErrorCount(newCount);
                console.error(`[Preview] Video load error #${newCount}:`, e);
                
                // Stop retrying after 3 errors to prevent spam
                if (newCount >= 3) {
                  console.warn('[Preview] Too many video errors, showing placeholder');
                  setError(t('preview.videoLoadError') || 'Failed to load video preview');
                  setPreviewVideoPath(null);
                }
              }}
              onLoadedData={() => {
                // Reset error count on successful load
                setVideoErrorCount(0);
                console.log('[Preview] Video loaded successfully');
              }}
            />
          </div>
        ) : (
          <div className="preview-placeholder">
            <ImageIcon size={48} />
            <p>{t('preview.noPreview') || 'No preview available'}</p>
          </div>
        )}
      </div>

      {/* Timeline */}
      {videoInfo && videoInfo.duration > 0 && (
        <div className="preview-timeline">
          <div className="preview-time-display">
            {formatTime(currentTime)} / {formatTime(videoInfo.duration)}
          </div>
          
          {/* Slider and keyframe temporarily deleted */}

          
          
        </div>
      )}

      {/* Refresh button */}
      <button
        className="preview-refresh-btn"
        onClick={() => generatePreview(true)}
        disabled={isLoading || !filePath}
      >
        <RefreshIcon className={isLoading ? 'spin' : ''} />
        {t('preview.refresh') || 'Refresh'}
      </button>
    </motion.div>
  );
};

export default PreviewPanel;
