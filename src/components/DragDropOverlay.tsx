import React from 'react';
import { Send, Folder, Globe, MessageSquare } from 'lucide-react';
import { useDragOverlayState } from '../hooks/useFileDragOut';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import './DragDropOverlay.css';

export const DragDropOverlay: React.FC = () => {
  const { isDragging, fileName } = useDragOverlayState();
  const { t } = useLanguage();
  const { theme } = useTheme();

  if (!isDragging) {
    return null;
  }

  return (
    <div className={`drag-drop-overlay ${isDragging ? 'is-active' : ''}`}>
      <div className="drag-drop-card">
        <div className="drag-drop-icon-wrap" style={{ color: theme.colors.primary }}>
          <Send size={26} strokeWidth={2.2} />
        </div>

        <h3 className="drag-drop-title">
          {t('queue.dragOverlayTitle') || 'Перетащите файл в другую программу'}
        </h3>

        <div className="drag-drop-badges-container">
          <span className="drag-drop-example-label">
            {t('queue.dragForExample') || 'например:'}
          </span>
          <div className="drag-drop-badges">
            <span className="drag-drop-badge badge-tg">
              <Send size={12} strokeWidth={2.2} /> Telegram
            </span>
            <span className="drag-drop-badge badge-dc">
              <MessageSquare size={12} strokeWidth={2.2} /> Discord
            </span>
            <span className="drag-drop-badge badge-browser">
              <Globe size={12} strokeWidth={2} /> {t('queue.dragBadgeBrowser') || 'Браузер'}
            </span>
            <span className="drag-drop-badge badge-explorer">
              <Folder size={12} strokeWidth={2} /> {t('queue.dragBadgeFolder') || 'Проводник'}
            </span>
          </div>
        </div>

        {fileName && (
          <div className="drag-drop-filename" title={fileName}>
            {fileName}
          </div>
        )}
      </div>
    </div>
  );
};

export default DragDropOverlay;
