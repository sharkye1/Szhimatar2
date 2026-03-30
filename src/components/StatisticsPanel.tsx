/**
 * StatisticsPanel - UI component for render statistics
 */

import React, { useState } from 'react';
import { save } from '@tauri-apps/api/dialog';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { Clock, RotateCw, Check, X, AlertCircle, Square, Download, Trash2, RotateCcw, Film, Volume2, Bookmark } from 'lucide-react';
import useStatistics from '../hooks/useStatistics';
import useRenderQueue from '../hooks/useRenderQueue';
import type { RenderStatRecord } from '../services/StatisticsService';
import '../styles/StatisticsPanel.css';

interface StatisticsPanelProps {
  onClose?: () => void;
}

const StatisticsPanel: React.FC<StatisticsPanelProps> = ({ onClose }) => {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const {
    renders,
    activeRenders,
    aggregateStats,
    isLoaded,
    clearHistory,
    exportStats,
    deleteRender,
    formatDuration,
  } = useStatistics();
  const { addToQueue } = useRenderQueue();

  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [filter, setFilter] = useState<'all' | 'completed' | 'error' | 'rendering' | 'stopped'>('all');

  // Filter renders
  const filteredRenders = renders.filter(r => {
    if (filter === 'all') return true;
    return r.status === filter;
  });

  // Get status display
  const getStatusDisplay = (record: RenderStatRecord) => {
    const statusMap: Record<string, { text: string; color: string; icon: React.ReactNode }> = {
      pending: { text: t('stats.pending') || 'Pending', color: theme.colors.textSecondary, icon: <Clock size={14} strokeWidth={2} /> },
      rendering: { text: t('stats.rendering') || 'Rendering', color: theme.colors.primary, icon: <RotateCw size={14} strokeWidth={2} /> },
      completed: { text: t('stats.completed') || 'Completed', color: theme.colors.success, icon: <Check size={14} strokeWidth={2} /> },
      error: { text: t('stats.error') || 'Error', color: theme.colors.error, icon: <X size={14} strokeWidth={2} /> },
      cancelled: { text: t('stats.cancelled') || 'Cancelled', color: theme.colors.textSecondary, icon: <AlertCircle size={14} strokeWidth={2} /> },
      stopped: { text: t('stats.stopped') || 'Stopped', color: theme.colors.warning, icon: <Square size={14} strokeWidth={2} /> },
    };
    return statusMap[record.status] || statusMap.pending;
  };

  // Handle export
  const handleExport = async () => {
    try {
      const filePath = await save({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: 'szhimatar-statistics.json',
      });
      
      if (filePath) {
        await exportStats(filePath);
      }
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  // Handle clear
  const handleClear = async () => {
    await clearHistory();
    setShowConfirmClear(false);
  };

  // Handle re-render overwrite (use same output path)
  const handleReRenderOverwrite = async (render: RenderStatRecord) => {
    try {
      await addToQueue(render.inputPath, render.outputPath);
      console.log('[StatisticsPanel] Re-render queued (overwrite):', render.inputPath);
    } catch (error) {
      console.error('[StatisticsPanel] Re-render failed:', error);
    }
  };

  // Handle re-render new version (add _2 to filename before extension)
  const handleReRenderNew = async (render: RenderStatRecord) => {
    try {
      // Parse filename: "path/to/file.ext" -> "path/to/file_2.ext"
      const lastDot = render.outputPath.lastIndexOf('.');
      const outputPathNew = lastDot > 0 
        ? render.outputPath.substring(0, lastDot) + '_2' + render.outputPath.substring(lastDot)
        : render.outputPath + '_2';
      
      await addToQueue(render.inputPath, outputPathNew);
      console.log('[StatisticsPanel] Re-render queued (new version):', render.inputPath, '→', outputPathNew);
    } catch (error) {
      console.error('[StatisticsPanel] Re-render failed:', error);
    }
  };

  // Format date
  const formatDate = (isoDate: string) => {
    const date = new Date(isoDate);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!isLoaded) {
    return (
      <div className="statistics-panel">
        <div className="stats-loading" style={{ color: theme.colors.textSecondary }}>
          {t('stats.loading') || 'Loading statistics...'}
        </div>
      </div>
    );
  }

  return (
    <div className="statistics-panel" style={{ color: theme.colors.text }}>
      {/* Header */}
      <div className="stats-header" style={{ borderColor: theme.colors.border }}>
        <h2>{t('stats.title') || 'Render Statistics'}</h2>
        {onClose && (
          <button onClick={onClose} className="close-btn" style={{ color: theme.colors.text }}>
            ×
          </button>
        )}
      </div>

      {/* Aggregate Stats */}
      <div className="stats-summary" style={{ background: theme.colors.background }}>
        <div className="stat-card">
          <span className="stat-value">{aggregateStats.total}</span>
          <span className="stat-label" style={{ color: theme.colors.textSecondary }}>
            {t('stats.totalRenders') || 'Total Renders'}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-value" style={{ color: theme.colors.success }}>
            {aggregateStats.successful}
          </span>
          <span className="stat-label" style={{ color: theme.colors.textSecondary }}>
            {t('stats.successful') || 'Successful'}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-value" style={{ color: theme.colors.error }}>
            {aggregateStats.failed}
          </span>
          <span className="stat-label" style={{ color: theme.colors.textSecondary }}>
            {t('stats.failed') || 'Failed'}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-value" style={{ color: theme.colors.warning }}>
            {aggregateStats.stopped}
          </span>
          <span className="stat-label" style={{ color: theme.colors.textSecondary }}>
            {t('stats.stopped') || 'Stopped'}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-value">
            {aggregateStats.successRate.toFixed(0)}%
          </span>
          <span className="stat-label" style={{ color: theme.colors.textSecondary }}>
            {t('stats.successRate') || 'Success Rate'}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-value">
            {formatDuration(aggregateStats.avgRenderTime)}
          </span>
          <span className="stat-label" style={{ color: theme.colors.textSecondary }}>
            {t('stats.avgTime') || 'Avg Time'}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-value">
            {formatDuration(aggregateStats.totalTime)}
          </span>
          <span className="stat-label" style={{ color: theme.colors.textSecondary }}>
            {t('stats.totalTime') || 'Total Time'}
          </span>
        </div>
      </div>

      {/* Active Renders */}
      {activeRenders.length > 0 && (
        <div className="active-renders" style={{ borderColor: theme.colors.border }}>
          <h3>{t('stats.activeRenders') || 'Active Renders'} ({activeRenders.length})</h3>
          {activeRenders.map(render => (
            <div 
              key={render.id} 
              className="active-render-item"
              style={{ background: theme.colors.background, borderColor: theme.colors.border }}
            >
              <div className="render-info">
                <span className="file-name">{render.fileName}</span>
                <div className="render-details" style={{ color: theme.colors.textSecondary }}>
                  <span>{render.progress.toFixed(1)}%</span>
                  <span>•</span>
                  <span>FPS: {render.fpsAchieved.toFixed(1)}</span>
                  <span>•</span>
                  <span>Speed: {render.speed.toFixed(2)}x</span>
                  <span>•</span>
                  <span>ETA: {render.etaFormatted}</span>
                </div>
              </div>
              <div 
                className="progress-bar" 
                style={{ background: theme.colors.border }}
              >
                <div 
                  className="progress-fill"
                  style={{ 
                    width: `${render.progress}%`, 
                    background: theme.colors.primary 
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="stats-toolbar" style={{ borderColor: theme.colors.border }}>
        <div className="filter-buttons">
          {(['all', 'completed', 'error', 'rendering', 'stopped'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={filter === f ? 'active' : ''}
              style={{
                background: filter === f ? theme.colors.primary : theme.colors.background,
                color: filter === f ? '#fff' : theme.colors.text,
                borderColor: theme.colors.border,
              }}
            >
              {t(`stats.filter.${f}`) || f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className="action-buttons">
          <button
            onClick={handleExport}
            style={{ background: theme.colors.primary, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Download size={16} strokeWidth={1.5} /> {t('stats.export') || 'Export'}
          </button>
          <button
            onClick={() => setShowConfirmClear(true)}
            style={{ background: theme.colors.error, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Trash2 size={16} strokeWidth={1.5} /> {t('stats.clear') || 'Clear'}
          </button>
        </div>
      </div>

      {/* Render History List */}
      <div className="render-history">
        {filteredRenders.length === 0 ? (
          <div className="empty-state" style={{ color: theme.colors.textSecondary }}>
            {t('stats.noRenders') || 'No renders in history'}
          </div>
        ) : (
          filteredRenders.map(render => {
            const status = getStatusDisplay(render);
            return (
              <div
                key={render.id}
                className="history-item"
                style={{ borderColor: theme.colors.border }}
              >
                <div className="history-main">
                  <div className="history-info">
                    <span className="history-filename">{render.fileName}</span>
                    <span className="history-output" style={{ color: theme.colors.textSecondary }}>
                      → {render.outputFile}
                    </span>
                  </div>
                  <div className="history-meta" style={{ color: theme.colors.textSecondary }}>
                    <span className="history-status" style={{ color: status.color }}>
                      {status.icon} {status.text}
                    </span>
                    <span>•</span>
                    <span>{formatDate(render.createdAt)}</span>
                    {render.status === 'completed' && (
                      <>
                        <span>•</span>
                        <span>{formatDuration(render.renderTime)}</span>
                        {render.speed > 0 && (
                          <>
                            <span>•</span>
                            <span>{render.speed.toFixed(1)}x</span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                  {render.error && (
                    <div className="history-error" style={{ color: theme.colors.error }}>
                      {render.error}
                    </div>
                  )}
                  <div className="history-settings" style={{ color: theme.colors.textSecondary }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Film size={12} strokeWidth={2} /> {render.video.codec} {render.video.bitrate}M CRF{render.video.crf}</span>
                    <span>•</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Volume2 size={12} strokeWidth={2} /> {render.audio.codec} {render.audio.bitrate}k</span>
                    {render.preset && (
                      <>
                        <span>•</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Bookmark size={12} strokeWidth={2} /> {render.preset}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="history-actions">
                  {render.status === 'completed' && (
                    <>
                      <button
                        onClick={() => handleReRenderOverwrite(render)}
                        className="re-render-btn overwrite"
                        title={t('history.re_render_overwrite') || 'Re-render (overwrite)'}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <RotateCcw size={14} strokeWidth={2} />
                      </button>
                      <button
                        onClick={() => handleReRenderNew(render)}
                        className="re-render-btn new"
                        title={t('history.re_render_new') || 'Re-render (new version)'}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <RotateCcw size={14} strokeWidth={2} />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => deleteRender(render.id)}
                    className="delete-btn"
                    style={{ color: theme.colors.error, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title={t('stats.delete') || 'Delete'}
                  >
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Confirm Clear Dialog */}
      {showConfirmClear && (
        <div className="confirm-overlay" onClick={() => setShowConfirmClear(false)}>
          <div 
            className="confirm-dialog" 
            onClick={e => e.stopPropagation()}
          >
            <h3>{t('stats.confirmClear') || 'Clear History?'}</h3>
            <p style={{ color: theme.colors.textSecondary }}>
              {t('stats.confirmClearText') || 'This will permanently delete all render history.'}
            </p>
            <div className="confirm-buttons">
              <button
                onClick={() => setShowConfirmClear(false)}
                style={{ background: theme.colors.background, color: theme.colors.text }}
              >
                {t('common.cancel') || 'Cancel'}
              </button>
              <button
                onClick={handleClear}
                style={{ background: theme.colors.error, color: '#fff' }}
              >
                {t('stats.clear') || 'Clear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatisticsPanel;
