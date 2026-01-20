/**
 * StatisticsPanel - UI component for render statistics
 */

import React, { useState } from 'react';
import { save } from '@tauri-apps/api/dialog';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';
import useStatistics from '../hooks/useStatistics';
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

  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [filter, setFilter] = useState<'all' | 'completed' | 'error' | 'rendering'>('all');

  // Filter renders
  const filteredRenders = renders.filter(r => {
    if (filter === 'all') return true;
    return r.status === filter;
  });

  // Get status display
  const getStatusDisplay = (record: RenderStatRecord) => {
    const statusMap: Record<string, { text: string; color: string; icon: string }> = {
      pending: { text: t('stats.pending') || 'Pending', color: theme.colors.textSecondary, icon: '⏳' },
      rendering: { text: t('stats.rendering') || 'Rendering', color: theme.colors.primary, icon: '🔄' },
      completed: { text: t('stats.completed') || 'Completed', color: theme.colors.success, icon: '✓' },
      error: { text: t('stats.error') || 'Error', color: theme.colors.error, icon: '✗' },
      cancelled: { text: t('stats.cancelled') || 'Cancelled', color: theme.colors.textSecondary, icon: '⊘' },
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

  // Format date
  const formatDate = (isoDate: string) => {
    const date = new Date(isoDate);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!isLoaded) {
    return (
      <div className="statistics-panel" style={{ background: theme.colors.surface }}>
        <div className="stats-loading" style={{ color: theme.colors.textSecondary }}>
          {t('stats.loading') || 'Loading statistics...'}
        </div>
      </div>
    );
  }

  return (
    <div className="statistics-panel" style={{ background: theme.colors.surface, color: theme.colors.text }}>
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
          {(['all', 'completed', 'error', 'rendering'] as const).map(f => (
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
            style={{ background: theme.colors.primary, color: '#fff' }}
          >
            📤 {t('stats.export') || 'Export'}
          </button>
          <button
            onClick={() => setShowConfirmClear(true)}
            style={{ background: theme.colors.error, color: '#fff' }}
          >
            🗑️ {t('stats.clear') || 'Clear'}
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
                    <span>📹 {render.video.codec} {render.video.bitrate}M CRF{render.video.crf}</span>
                    <span>•</span>
                    <span>🔊 {render.audio.codec} {render.audio.bitrate}k</span>
                    {render.preset && (
                      <>
                        <span>•</span>
                        <span>📋 {render.preset}</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteRender(render.id)}
                  className="delete-btn"
                  style={{ color: theme.colors.error }}
                  title={t('stats.delete') || 'Delete'}
                >
                  ×
                </button>
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
            style={{ background: theme.colors.surface, borderColor: theme.colors.border }}
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
