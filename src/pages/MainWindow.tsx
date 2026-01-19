import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import '../styles/MainWindow.css';

interface QueueItem {
  id: number;
  name: string;
  path: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
}

type Screen = 'main' | 'video' | 'audio' | 'general' | 'watermark';

interface MainWindowProps {
  onNavigate: (screen: Screen) => void;
}

const MainWindow: React.FC<MainWindowProps> = ({ onNavigate }) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [outputFolder, setOutputFolder] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

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
        const newItems: QueueItem[] = selected.map((path, index) => ({
          id: Date.now() + index,
          name: path.split(/[\\/]/).pop() || path,
          path,
          status: 'pending',
          progress: 0
        }));
        setQueue([...queue, ...newItems]);
        
        await invoke('write_log', { message: `Added ${newItems.length} files to queue` });
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
        setOutputFolder(selected);
        await invoke('write_log', { message: `Set output folder: ${selected}` });
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
    }
  };

  const handleStart = async () => {
    setIsProcessing(true);
    setIsPaused(false);
    await invoke('write_log', { message: 'Started processing queue' });
    // TODO: Implement FFmpeg processing logic
  };

  const handlePause = async () => {
    setIsPaused(!isPaused);
    await invoke('write_log', { message: isPaused ? 'Resumed processing' : 'Paused processing' });
    // TODO: Implement pause logic
  };

  const handleStop = async () => {
    setIsProcessing(false);
    setIsPaused(false);
    await invoke('write_log', { message: 'Stopped processing' });
    // TODO: Implement stop logic (kill ffmpeg process)
  };

  return (
    <div className="main-window fade-in" style={{ background: theme.colors.background, color: theme.colors.text }}>
      <header className="header" style={{ background: theme.colors.surface, borderColor: theme.colors.border }}>
        <h1>{t('app.title')}</h1>
        <div className="header-buttons">
          <button onClick={() => onNavigate('video')} style={{ background: theme.colors.primary, color: '#fff' }}>
            📹 {t('video.title')}
          </button>
          <button onClick={() => onNavigate('audio')} style={{ background: theme.colors.primary, color: '#fff' }}>
            🔊 {t('audio.title')}
          </button>
          <button onClick={() => onNavigate('watermark')} style={{ background: theme.colors.primary, color: '#fff' }}>
            🖼️ Watermark
          </button>
          <button onClick={() => onNavigate('general')} style={{ background: theme.colors.secondary, color: '#fff' }}>
            ⚙️ {t('settings.title')}
          </button>
        </div>
      </header>

      <div className="content">
        <div className="file-selection">
          <button onClick={handleSelectFiles} style={{ background: theme.colors.primary, color: '#fff' }}>
            📁 {t('main.selectFiles')}
          </button>
          <button onClick={handleSelectOutputFolder} style={{ background: theme.colors.primary, color: '#fff' }}>
            💾 {t('main.outputFolder')}
          </button>
          {outputFolder && (
            <div className="output-path" style={{ color: theme.colors.textSecondary }}>
              {outputFolder}
            </div>
          )}
        </div>

        <div className="queue-section">
          <h2>{t('main.queue')} ({queue.length})</h2>
          <div className="queue-list" style={{ background: theme.colors.surface, borderColor: theme.colors.border }}>
            {queue.length === 0 ? (
              <div className="empty-queue" style={{ color: theme.colors.textSecondary }}>
                {t('main.selectFiles')}...
              </div>
            ) : (
              queue.map(item => (
                <div key={item.id} className="queue-item" style={{ borderColor: theme.colors.border }}>
                  <div className="item-info">
                    <span className="item-name">{item.name}</span>
                    <span className="item-status" style={{ 
                      color: item.status === 'completed' ? theme.colors.success : 
                             item.status === 'error' ? theme.colors.error : 
                             theme.colors.textSecondary 
                    }}>
                      {item.status}
                    </span>
                  </div>
                  {item.status === 'processing' && (
                    <div className="progress-bar" style={{ background: theme.colors.border }}>
                      <div 
                        className="progress-fill" 
                        style={{ 
                          width: `${item.progress}%`, 
                          background: theme.colors.primary 
                        }}
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="controls">
          <button 
            onClick={handleStart} 
            disabled={isProcessing || queue.length === 0}
            style={{ background: theme.colors.success, color: '#fff' }}
          >
            ▶️ {t('main.start')}
          </button>
          <button 
            onClick={handlePause} 
            disabled={!isProcessing}
            style={{ background: theme.colors.warning, color: '#fff' }}
          >
            {isPaused ? '▶️' : '⏸️'} {t('main.pause')}
          </button>
          <button 
            onClick={handleStop} 
            disabled={!isProcessing}
            style={{ background: theme.colors.error, color: '#fff' }}
          >
            ⏹️ {t('main.stop')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MainWindow;
