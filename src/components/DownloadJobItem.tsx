import React, { useState, useRef, useEffect } from 'react';
import { Trash2, Folder, Square, RefreshCw, Check, X, Clock, Copy, GripVertical } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { DownloadQueueItem } from '../services/DownloadService';
import { useFileDragOut } from '../hooks/useFileDragOut';

export interface DownloadJobItemProps {
  item: DownloadQueueItem;
  theme: any;
  t: (key: string) => string;
  onShowInExplorer: (filePath: string) => void;
  onRemoveJob: (jobId: string) => void;
  onStopJob?: (jobId: string) => void;
}

export const DownloadJobItem: React.FC<DownloadJobItemProps> = React.memo(({
  item,
  theme,
  t,
  onShowInExplorer,
  onRemoveJob,
  onStopJob,
}) => {
  const getStatusDisplay = () => {
    switch (item.status) {
      case 'downloading':
        return {
          text: t('download.status.downloading') || 'Скачивание',
          color: theme.colors.primary,
          icon: <RefreshCw size={13} strokeWidth={2} className="download-spin" />,
        };
      case 'completed':
        return {
          text: t('download.status.completed') || 'Готово',
          color: theme.colors.success,
          icon: <Check size={13} strokeWidth={2} />,
        };
      case 'error':
        return {
          text: t('download.status.error') || 'Ошибка',
          color: theme.colors.error,
          icon: <X size={13} strokeWidth={2} />,
        };
      case 'stopped':
        return {
          text: t('download.status.stopped') || 'Остановлено',
          color: theme.colors.warning,
          icon: <Square size={13} strokeWidth={2} />,
        };
      case 'pending':
      default:
        return {
          text: t('download.status.pending') || 'В очереди',
          color: theme.colors.textSecondary,
          icon: <Clock size={13} strokeWidth={2} />,
        };
    }
  };

  const statusDisplay = getStatusDisplay();
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

  const finalPath = item.filePath || item.savePath;

  const handleCopyFile = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (copied || !finalPath) return;
    try {
      await invoke('copy_file_to_clipboard', { filePath: finalPath });
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy file:', err);
    }
  };

  const displayName = item.title
    || item.fileName
    || (item.status === 'downloading' ? (t('download.downloadingMedia') || 'Скачивание медиа...') : null)
    || (item.status === 'pending' ? (t('download.waitingToStart') || 'Ожидание запуска') : null)
    || item.label
    || item.url;

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
        {/* Left column: Status, Size info, Format badge, Video title */}
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
          {/* Drag handle for completed downloads */}
          {item.status === 'completed' && finalPath && (
            <div
              className="drag-handle-btn"
              onMouseDown={(e) => startFileDrag(finalPath, displayName || undefined, e)}
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

          {/* Size badge when completed */}
          {item.status === 'completed' && item.fileSize && (
            <span
              style={{
                fontSize: '0.75rem',
                color: theme.colors.success,
                fontWeight: '600',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <span>{item.fileSize}</span>
            </span>
          )}

          {/* Format badge (e.g. MP4, MP3) */}
          <span
            style={{
              background: item.status === 'completed' ? theme.colors.success : theme.colors.primary,
              color: '#fff',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '0.7rem',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {item.format.toUpperCase()}
          </span>

          {/* Video Title / Name */}
          <span
            className="item-name"
            title={item.filePath || item.url}
            style={{
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flex: 1,
            }}
          >
            {displayName}
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
          {/* Speed display during downloading */}
          {item.status === 'downloading' && item.speed && (
            <span style={{ fontSize: '0.8rem', color: theme.colors.textSecondary, whiteSpace: 'nowrap' }}>
              {item.speed}
            </span>
          )}

          {/* Stop button while downloading */}
          {item.status === 'downloading' && onStopJob && (
            <button
              onClick={() => onStopJob(item.id)}
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
              title={t('download.stopDownload') || 'Stop download'}
            >
              <Square size={13} fill="currentColor" />
            </button>
          )}

          {/* Show in Explorer button for completed downloads */}
          {item.status === 'completed' && (item.filePath || item.savePath) && (
            <>
            <button
              onClick={() => onShowInExplorer(item.filePath || item.savePath)}
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
              <Folder size={14} strokeWidth={1.5} /> {t('queue.show') || 'Показать'}
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
              title={copied ? (t('queue.copiedToClipboard') || 'Скопировано в буфер') : (t('queue.copyToClipboard') || 'Скопировать файл в буфер')}
            >
              {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.5} />}
            </button>
            </>
          )}

          {/* Delete button */}
          {(item.status === 'pending' ||
            item.status === 'completed' ||
            item.status === 'error' ||
            item.status === 'stopped') && (
            <button
              onClick={() => onRemoveJob(item.id)}
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

      {/* Error message */}
      {(item.error || (item.status === 'error' && item.message)) && (
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
          {item.error || item.message}
        </div>
      )}

      {/* Progress section while downloading */}
      {item.status === 'downloading' && (
        <div className="progress-section" style={{ marginTop: '8px', width: '100%' }}>
          <div className="progress-bar" style={{ background: theme.colors.border, height: '8px', borderRadius: '4px' }}>
            <div
              className="progress-fill"
              style={{
                width: `${item.progress}%`,
                background: theme.colors.primary,
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
            <span>{item.progress.toFixed(1)}%</span>
            <div style={{ display: 'flex', gap: '12px' }}>
              {item.totalSize && (
                <span style={{ fontFamily: 'monospace' }}>{item.totalSize}</span>
              )}
              <span>ETA: {item.eta || '--:--'}</span>
              {item.speed && <span>{item.speed}</span>}
            </div>
          </div>
        </div>
      )}

      {/* Completed info subline */}
      {item.status === 'completed' && (
        <div
          className="completed-info"
          style={{
            fontSize: '0.8rem',
            color: theme.colors.success,
            marginTop: '6px',
            display: 'flex',
            gap: '8px',
            width: '100%',
            overflow: 'hidden',
          }}
        >
          <span style={{ flexShrink: 0 }}>{t('queue.completedWithSize') || 'Готово'}</span>
          <span style={{ color: theme.colors.textSecondary, fontFamily: 'monospace', flexShrink: 0 }}>
            {(() => {
              const metaParts = [];
              if (item.fileSize) metaParts.push(item.fileSize);
              if (item.durationFormatted) metaParts.push(item.durationFormatted);
              return metaParts.length > 0 ? `(${metaParts.join(' | ')})` : '';
            })()}
          </span>
          <span
            style={{
              color: theme.colors.textSecondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flex: 1,
            }}
            title={item.filePath || item.savePath}
          >
            • {item.filePath || item.savePath}
          </span>
        </div>
      )}
    </div>
  );
});

DownloadJobItem.displayName = 'DownloadJobItem';
export default DownloadJobItem;