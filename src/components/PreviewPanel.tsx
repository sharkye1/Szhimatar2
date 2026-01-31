import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
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
}

interface VideoPreviewInfo {
  duration: number;
  width: number;
  height: number;
}

interface PreviewPanelProps {
  inputPath: string;
  settings: PreviewSettings;
  isVisible: boolean;
  onToggleVisibility: () => void;
}

const PreviewPanel: React.FC<PreviewPanelProps> = ({
  inputPath,
  settings,
  isVisible,
  onToggleVisibility,
}) => {
  const { t } = useLanguage();
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
  
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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
    if (!inputPath) {
      setVideoInfo(null);
      setOriginalFrame(null);
      setProcessedFrame(null);
      return;
    }

    const loadVideoInfo = async () => {
      try {
        const info = await invoke<VideoPreviewInfo>('get_video_info_for_preview', {
          inputPath,
        });
        setVideoInfo(info);
        setCurrentTime(0);
      } catch (err) {
        console.error('Failed to get video info:', err);
        setError(String(err));
      }
    };

    loadVideoInfo();
  }, [inputPath]);

  // Generate preview with 5-second debounce
  const generatePreview = useCallback(async () => {
    if (!inputPath || !videoInfo) return;

    setIsLoading(true);
    setError(null);

    try {
      if (mode === 'frame') {
        // Get original frame (no processing)
        const original = await invoke<string>('get_preview_frame', {
          inputPath,
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

        // Get processed frame
        const processed = await invoke<string>('get_preview_frame', {
          inputPath,
          timeSeconds: currentTime,
          settings,
        });
        setProcessedFrame(`data:image/jpeg;base64,${processed}`);
      } else {
        // Video mode
        const videoPath = await invoke<string>('get_preview_video', {
          inputPath,
          timeSeconds: currentTime,
          duration: 3.0,
          settings,
        });
        setPreviewVideoPath(videoPath);
      }
    } catch (err) {
      console.error('Preview generation failed:', err);
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [inputPath, currentTime, settings, mode, videoInfo]);

  // Debounced preview generation on settings change
  useEffect(() => {
    if (!isVisible || !inputPath) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      generatePreview();
    }, 5000); // 5-second debounce

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [settings, isVisible, inputPath]);

  // Generate preview immediately when time changes
  useEffect(() => {
    if (!isVisible || !inputPath || !videoInfo) return;
    
    // Cancel previous debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    generatePreview();
  }, [currentTime]);

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

  if (!isVisible) {
    return (
      <motion.button
        className="preview-toggle-btn"
        onClick={onToggleVisibility}
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
      className="preview-panel"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
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
            onClick={onToggleVisibility}
            title={t('preview.hide') || 'Hide Preview'}
          >
            <EyeOffIcon />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="preview-content">
        {!inputPath ? (
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
            <button onClick={generatePreview}>
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
              src={`asset://localhost/${previewVideoPath.replace(/\\/g, '/')}`}
              controls
              loop
              autoPlay
              muted
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
          
          <div className="preview-slider-container">
            <input
              type="range"
              min={0}
              max={videoInfo.duration}
              step={0.1}
              value={currentTime}
              onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
              className="preview-slider"
            />
            
            {/* Keyframe markers */}
            <div className="preview-keyframes">
              {keyframes.map((time, index) => (
                <button
                  key={index}
                  className="preview-keyframe-btn"
                  style={{ left: `${(time / videoInfo.duration) * 100}%` }}
                  onClick={() => setCurrentTime(time)}
                  title={`${['0%', '50%', '90%'][index]} - ${formatTime(time)}`}
                >
                  <div className="preview-keyframe-marker" />
                </button>
              ))}
            </div>
          </div>

          <div className="preview-keyframe-buttons">
            {['0%', '50%', '90%'].map((label, index) => (
              <button
                key={label}
                onClick={() => setCurrentTime(keyframes[index])}
                className="preview-keyframe-quick-btn"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Refresh button */}
      <button
        className="preview-refresh-btn"
        onClick={generatePreview}
        disabled={isLoading || !inputPath}
      >
        <RefreshIcon className={isLoading ? 'spin' : ''} />
        {t('preview.refresh') || 'Refresh'}
      </button>
    </motion.div>
  );
};

export default PreviewPanel;
