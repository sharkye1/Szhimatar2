import React, { useState, useRef, useEffect } from 'react';
import { Trash2, Folder, Square, Copy, Check, GripVertical } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { RenderJob } from '../services/RenderService';
import { useJobProgress } from '../hooks/useRenderQueue';
import { useFileDragOut } from '../hooks/useFileDragOut';

export interface TrimFramePreviewState {
  jobId: string;
  handle: 'start' | 'end';
  timeSec: number;
  leftPercent: number;
  imageDataUrl: string | null;
  loading: boolean;
}

export interface RenderJobItemProps {
  job: RenderJob;
  theme: any;
  t: (key: string) => string;
  onAddToQueue: (inputPath: string, outputPath: string, trimStartSec?: number, trimEndSec?: number) => void;
  onShowInExplorer: (outputPath: string) => void;
  onRemoveJob: (jobId: string) => void;
  onStopJob?: (jobId: string) => void;
  onUpdateJobTrim: (jobId: string, start: number, end: number) => void;
  onRequestTrimFramePreview: (jobId: string, inputPath: string, timeSec: number, leftPercent: number, handle: 'start' | 'end') => void;
  onHideTrimFramePreview: () => void;
  trimFramePreview: TrimFramePreviewState | null;
  formatTrimTime: (sec: number) => string;
  formatDurationCompact: (sec: number) => string;
  getStatusDisplay: (job: RenderJob) => { text: string; color: string; icon: React.ReactNode };
}

const trimStepSec = 0.5;
const minTrimDurationSec = 1;

export const RenderJobItem: React.FC<RenderJobItemProps> = React.memo(({
  job,
  theme,
  t,
  onAddToQueue,
  onShowInExplorer,
  onRemoveJob,
  onStopJob,
  onUpdateJobTrim,
  onRequestTrimFramePreview,
  onHideTrimFramePreview,
  trimFramePreview,
  formatTrimTime,
  formatDurationCompact,
  getStatusDisplay,
}) => {
  const liveProgress = useJobProgress(job.id);
  const statusDisplay = getStatusDisplay(job);
  const { startFileDrag } = useFileDragOut();

  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopyFile = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (copied || !job.outputPath) return;
    try {
      await invoke('copy_file_to_clipboard', { filePath: job.outputPath });
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy file:', err);
    }
  };

  const progress = liveProgress ? liveProgress.progress : job.progress;
  const fps = liveProgress ? liveProgress.fps : job.fps;
  const speed = liveProgress ? liveProgress.speed : job.speed;
  const etaFormatted = liveProgress ? liveProgress.etaFormatted : job.etaFormatted;
  const outputSize = liveProgress ? liveProgress.outputSize : job.outputSize;
  const estimatedFinalSize = liveProgress ? liveProgress.estimatedFinalSize : job.estimatedFinalSize;

  return (
    <div className="queue-item" style={{ borderColor: theme.colors.border }}>
      {/* Top row: Left metadata and Right action buttons */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          minHeight: '32px',
          gap: '12px',
        }}
      >
        {/* Left column: Status, Size info, Slot badge, File name */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {/* Drag handle for completed jobs */}
          {job.status === 'completed' && job.outputPath && (
            <div
              className="drag-handle-btn"
              onMouseDown={(e) => startFileDrag(job.outputPath, job.fileName, e)}
              title={t('queue.dragHandleTooltip') || 'Зажмите и перетащите файл в Telegram, Discord или папку'}
            >
              <GripVertical size={15} strokeWidth={2.4} />
            </div>
          )}

          {/* Status badge with icon */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              background: `${statusDisplay.color}20`,
              color: statusDisplay.color,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <span>{statusDisplay.icon}</span>
            <span>{statusDisplay.text}</span>
          </span>

          {/* File sizes info */}
          {job.inputSize && (
            <span
              style={{
                fontSize: '0.75rem',
                color: theme.colors.textSecondary,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <span>{job.inputSize}</span>
              {job.status === 'completed' && outputSize && (
                <>
                  <span>→</span>
                  <span
                    style={{
                      color: theme.colors.success,
                      fontWeight: '600',
                    }}
                  >
                    {outputSize}
                  </span>
                </>
              )}
            </span>
          )}

          {/* CPU/GPU slot badge */}
          {job.assignedSlot && job.status !== 'pending' && (
            <span
              style={{
                background: job.assignedSlot === 'gpu' ? theme.colors.success : theme.colors.primary,
                color: '#fff',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {job.assignedSlot.toUpperCase()}
            </span>
          )}

          {/* File name */}
          <span
            className="item-name"
            title={job.inputPath}
            style={{
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flex: 1,
            }}
          >
            {job.fileName}
          </span>
        </div>

        {/* Right column: Action buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginLeft: 'auto',
            flexShrink: 0,
          }}
        >
          {/* FPS and speed for processing */}
          {job.status === 'processing' && (
            <span style={{ fontSize: '0.8rem', color: theme.colors.textSecondary, whiteSpace: 'nowrap' }}>
              {fps > 0 && `${fps.toFixed(1)} fps`}
              {speed > 0 && ` • ${speed.toFixed(2)}x`}
            </span>
          )}

          {/* Stop button for processing/paused tasks */}
          {(job.status === 'processing' || job.status === 'paused') && onStopJob && (
            <button
              onClick={() => onStopJob(job.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                background: `${theme.colors.warning}15`,
                border: `1px solid ${theme.colors.warning}40`,
                borderRadius: '6px',
                color: theme.colors.warning,
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `${theme.colors.warning}30`;
                e.currentTarget.style.borderColor = theme.colors.warning;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = `${theme.colors.warning}15`;
                e.currentTarget.style.borderColor = `${theme.colors.warning}40`;
              }}
              title={t('queue.stopJob') || 'Stop task'}
            >
              <Square size={13} fill="currentColor" />
            </button>
          )}

          {/* Re-render buttons for completed, error, and stopped tasks */}
          {(job.status === 'completed' || job.status === 'error' || job.status === 'stopped') && (
            <>
              <button
                onClick={() => onAddToQueue(job.inputPath, job.outputPath, job.trimStartSec, job.trimEndSec)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '28px',
                  height: '28px',
                  background: `${theme.colors.success}15`,
                  border: `1px solid ${theme.colors.success}40`,
                  borderRadius: '6px',
                  color: theme.colors.success,
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `${theme.colors.success}30`;
                  e.currentTarget.style.borderColor = theme.colors.success;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = `${theme.colors.success}15`;
                  e.currentTarget.style.borderColor = `${theme.colors.success}40`;
                }}
                title={t('queue.retry') || t('history.re_render_overwrite') || 'Re-render (overwrite)'}
              >
                ↺
              </button>
              <button
                onClick={() => {
                  const lastDot = job.outputPath.lastIndexOf('.');
                  const outputPathNew =
                    lastDot > 0
                      ? job.outputPath.substring(0, lastDot) + '_2' + job.outputPath.substring(lastDot)
                      : job.outputPath + '_2';
                  onAddToQueue(job.inputPath, outputPathNew, job.trimStartSec, job.trimEndSec);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 6px',
                  height: '28px',
                  background: `${theme.colors.primary}15`,
                  border: `1px solid ${theme.colors.primary}40`,
                  borderRadius: '6px',
                  color: theme.colors.primary,
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  fontWeight: 'bold',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `${theme.colors.primary}30`;
                  e.currentTarget.style.borderColor = theme.colors.primary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = `${theme.colors.primary}15`;
                  e.currentTarget.style.borderColor = `${theme.colors.primary}40`;
                }}
                title={t('queue.retryNewFile') || t('history.re_render_new') || 'Re-render (new version)'}
              >
                ↻2
              </button>
            </>
          )}

          {/* Show in Explorer button for completed tasks */}
          {job.status === 'completed' && job.outputPath && (
            <>
            <button
              onClick={() => onShowInExplorer(job.outputPath)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                height: '28px',
                background: `${theme.colors.success}15`,
                border: `1px solid ${theme.colors.success}40`,
                borderRadius: '6px',
                color: theme.colors.success,
                cursor: 'pointer',
                fontSize: '0.75rem',
                fontWeight: '500',
                transition: 'all 0.15s ease',
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
            <button
              onClick={handleCopyFile}
              disabled={copied}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                height: '28px',
                background: copied ? `${theme.colors.success}30` : `${theme.colors.success}15`,
                border: copied ? `1px solid ${theme.colors.success}` : `1px solid ${theme.colors.success}40`,
                borderRadius: '6px',
                color: theme.colors.success,
                cursor: copied ? 'default' : 'pointer',
                fontSize: '0.75rem',
                fontWeight: '500',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (copied) return;
                e.currentTarget.style.background = `${theme.colors.success}30`;
                e.currentTarget.style.borderColor = theme.colors.success;
              }}
              onMouseLeave={(e) => {
                if (copied) return;
                e.currentTarget.style.background = `${theme.colors.success}15`;
                e.currentTarget.style.borderColor = `${theme.colors.success}40`;
              }}
              title={copied ? (t('queue.copiedToClipboard') || 'Copied to clipboard') : (t('queue.copyToClipboard') || 'Copy file to clipboard')}
            >
              {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.5} />}
            </button>
            </>
          )}

          {/* Delete button */}
          {(job.status === 'pending' ||
            job.status === 'completed' ||
            job.status === 'error' ||
            job.status === 'stopped') && (
            <button
              onClick={() => onRemoveJob(job.id)}
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
                transition: 'all 0.15s ease',
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
              <Trash2 size={14} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {/* Trim control */}
      {job.status === 'pending' && job.durationSeconds > 0 && (() => {
        const duration = job.durationSeconds;
        const trimStart = Math.max(0, Math.min(duration, job.trimStartSec ?? 0));
        const trimEnd = Math.max(trimStart, Math.min(duration, job.trimEndSec ?? duration));
        const editable = job.status === 'pending';
        const startPercent = duration > 0 ? (trimStart / duration) * 100 : 0;
        const endPercent = duration > 0 ? (trimEnd / duration) * 100 : 0;
        const selectedPercent = duration > 0 ? ((trimEnd - trimStart) / duration) * 100 : 0;

        return (
          <div
            className={`trim-control ${editable ? 'is-editable' : 'is-readonly'}`}
            style={{
              ['--trim-accent' as string]: theme.colors.primary,
              borderColor: theme.colors.border,
              background: 'rgba(var(--theme-bg-rgb), 0.12)',
              marginTop: '8px',
              width: '100%',
            }}
          >
            <div className="trim-head" style={{ color: theme.colors.textSecondary }}>
              <span>{t('queue.trim') || 'Trim'}</span>
              <span>
                {t('queue.trimRange') || 'Range'}: {formatTrimTime(trimStart)} - {formatTrimTime(trimEnd)}
              </span>
              <span>
                {t('queue.trimDuration') || 'Length'}: {formatTrimTime(trimEnd - trimStart)}
              </span>
            </div>

            <div className="trim-slider-wrap">
              {trimFramePreview && trimFramePreview.jobId === job.id && (
                <div
                  className="trim-frame-preview"
                  style={{ left: `${trimFramePreview.leftPercent}%` }}
                >
                  {trimFramePreview.imageDataUrl ? (
                    <img
                      src={trimFramePreview.imageDataUrl}
                      alt={`${job.fileName} ${formatTrimTime(trimFramePreview.timeSec)}`}
                      className="trim-frame-preview-image"
                    />
                  ) : (
                    <div className="trim-frame-preview-skeleton" />
                  )}
                  <span className="trim-frame-preview-time">
                    {trimFramePreview.loading ? '...' : formatTrimTime(trimFramePreview.timeSec)}
                  </span>
                </div>
              )}

              <div className="trim-slider-track" style={{ background: `${theme.colors.border}99` }} />
              <div
                className="trim-slider-selected"
                style={{
                  left: `${startPercent}%`,
                  width: `${selectedPercent}%`,
                  background: `${theme.colors.primary}66`,
                }}
              />

              <input
                type="range"
                className="trim-range trim-range-start"
                min={0}
                max={duration}
                step={trimStepSec}
                value={trimStart}
                disabled={!editable}
                onMouseDown={() => {
                  onRequestTrimFramePreview(job.id, job.inputPath, trimStart, startPercent, 'start');
                }}
                onTouchStart={() => {
                  onRequestTrimFramePreview(job.id, job.inputPath, trimStart, startPercent, 'start');
                }}
                onChange={(e) => {
                  const nextStart = Math.min(parseFloat(e.target.value), trimEnd - minTrimDurationSec);
                  onUpdateJobTrim(job.id, nextStart, trimEnd);
                  const nextStartPercent = duration > 0 ? (nextStart / duration) * 100 : 0;
                  onRequestTrimFramePreview(job.id, job.inputPath, nextStart, nextStartPercent, 'start');
                }}
                onMouseUp={() => onHideTrimFramePreview()}
                onTouchEnd={() => onHideTrimFramePreview()}
                onBlur={() => onHideTrimFramePreview()}
                aria-label={`${job.fileName} trim start`}
              />
              <input
                type="range"
                className="trim-range trim-range-end"
                min={0}
                max={duration}
                step={trimStepSec}
                value={trimEnd}
                disabled={!editable}
                onMouseDown={() => {
                  onRequestTrimFramePreview(job.id, job.inputPath, trimEnd, endPercent, 'end');
                }}
                onTouchStart={() => {
                  onRequestTrimFramePreview(job.id, job.inputPath, trimEnd, endPercent, 'end');
                }}
                onChange={(e) => {
                  const nextEnd = Math.max(parseFloat(e.target.value), trimStart + minTrimDurationSec);
                  onUpdateJobTrim(job.id, trimStart, nextEnd);
                  const nextEndPercent = duration > 0 ? (nextEnd / duration) * 100 : 0;
                  onRequestTrimFramePreview(job.id, job.inputPath, nextEnd, nextEndPercent, 'end');
                }}
                onMouseUp={() => onHideTrimFramePreview()}
                onTouchEnd={() => onHideTrimFramePreview()}
                onBlur={() => onHideTrimFramePreview()}
                aria-label={`${job.fileName} trim end`}
              />
            </div>

            {!editable && (
              <div className="trim-readonly-note" style={{ color: theme.colors.textSecondary }}>
                {t('queue.trimReadonly') || 'Trim can be edited only while item is pending'}
              </div>
            )}
          </div>
        );
      })()}

      {/* Error message */}
      {job.error && (
        <div
          className="item-error"
          style={{
            fontSize: '0.8rem',
            color: theme.colors.error,
            marginTop: '8px',
            padding: '6px 10px',
            background: `${theme.colors.error}10`,
            borderRadius: '4px',
            width: '100%',
          }}
        >
          {job.error}
        </div>
      )}

      {/* Progress Bar & Details */}
      {(job.status === 'processing' || job.status === 'paused') && (
        <div className="progress-section" style={{ marginTop: '8px', width: '100%' }}>
          <div className="progress-bar" style={{ background: theme.colors.border, height: '8px', borderRadius: '4px' }}>
            <div
              className="progress-fill"
              style={{
                width: `${progress}%`,
                background: job.status === 'paused' ? theme.colors.warning : theme.colors.primary,
                height: '100%',
                borderRadius: '4px',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <div
            className="progress-details"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.8rem',
              color: theme.colors.textSecondary,
              marginTop: '4px',
            }}
          >
            <span>{progress.toFixed(1)}%</span>
            <div style={{ display: 'flex', gap: '12px' }}>
              {(job.outputSizeBytes > 0 || outputSize) && (
                <span style={{ fontFamily: 'monospace' }}>
                  {outputSize}
                  {estimatedFinalSize && (
                    <span style={{ color: theme.colors.textSecondary }}>
                      {' / '}
                      {estimatedFinalSize}
                    </span>
                  )}
                </span>
              )}
              <span>ETA: {etaFormatted}</span>
            </div>
          </div>
        </div>
      )}

      {/* Completed Info */}
      {job.status === 'completed' && (
        <div
          className="completed-info"
          style={{
            fontSize: '0.8rem',
            color: theme.colors.success,
            marginTop: '6px',
            display: 'flex',
            gap: '8px',
            width: '100%',
          }}
        >
          <span>{t('queue.completedWithSize')}</span>
          <span style={{ color: theme.colors.textSecondary, fontFamily: 'monospace' }}>
            {(() => {
              const sourceDuration = Math.max(0, job.durationSeconds || 0);
              const trimStart = Math.max(0, Math.min(sourceDuration, job.trimStartSec ?? 0));
              const trimEnd = Math.max(trimStart, Math.min(sourceDuration, job.trimEndSec ?? sourceDuration));
              const resultDuration = sourceDuration > 0 ? Math.max(0, trimEnd - trimStart) : 0;
              const sourceSize = job.inputSize || '—';
              const resultSize = job.outputSizeBytes > 0 ? outputSize : '—';

              return `(${sourceSize} → ${resultSize} | ${formatDurationCompact(sourceDuration)} → ${formatDurationCompact(resultDuration)})`;
            })()}
          </span>
        </div>
      )}
    </div>
  );
});

RenderJobItem.displayName = 'RenderJobItem';
export default RenderJobItem;
