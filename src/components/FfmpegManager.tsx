import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/api/dialog';
import { ffmpegFinder } from '../services/FFmpegFinder';
import { useLanguage } from '../contexts/LanguageContext';
import '../styles/FfmpegManager.css';

interface FfmpegStatus {
  ffmpeg_found: boolean;
  ffprobe_found: boolean;
  ffmpeg_path: string;
  ffprobe_path: string;
  ffmpeg_version: string;
  ffprobe_version: string;
}

type SearchStage = 'idle' | 'searching' | 'deep-search-warning' | 'deep-searching' | 'complete' | 'error';

// Helper function to detect Windows platform
const isWindows = (): boolean => {
  return navigator.userAgent.toLowerCase().includes('windows') || 
         navigator.platform.toLowerCase().includes('win');
};

/**
 * Strip Windows \\?\ prefix from path for clean display
 * This prefix appears in long/UNC paths but shouldn't be shown to users
 */
const cleanPath = (path: string): string => {
  if (!path) return '';
  // Remove \\?\ or \\?\UNC\ prefix from Windows paths
  return path.replace(/^\\\\\?\\(UNC\\)?/, '');
};

export function FfmpegManager() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<FfmpegStatus | null>(null);
  const [searchStage, setSearchStage] = useState<SearchStage>('idle');
  const [searchMessage, setSearchMessage] = useState('');
  const [filesChecked, setFilesChecked] = useState(0);
  const [error, setError] = useState('');
  const [customFfmpegPath, setCustomFfmpegPath] = useState('');
  const [customFfprobePath, setCustomFfprobePath] = useState('');

  // Check status on mount
  useEffect(() => {
    checkStatus();

    // Listen for search progress events
    const unlistenStage = listen<string>('ffmpeg-search-stage', (event) => {
      setSearchMessage(event.payload);
    });

    const unlistenProgress = listen<number>('ffmpeg-search-progress', (event) => {
      setFilesChecked(event.payload);
    });

    return () => {
      unlistenStage.then((fn) => fn());
      unlistenProgress.then((fn) => fn());
    };
  }, []);

  const checkStatus = async () => {
    try {
      const result = await ffmpegFinder.findFFmpeg(false);
      setStatus({
        ffmpeg_found: !!result.ffmpeg?.isValid,
        ffprobe_found: !!result.ffprobe?.isValid,
        ffmpeg_path: cleanPath(result.ffmpeg?.path || ''),
        ffprobe_path: cleanPath(result.ffprobe?.path || ''),
        ffmpeg_version: result.ffmpeg?.version || '',
        ffprobe_version: result.ffprobe?.version || ''
      });
    } catch (err) {
      console.error('Failed to check FFmpeg status:', err);
      setError(String(err));
    }
  };

  const handleFastSearch = async () => {
    setSearchStage('searching');
    setSearchMessage(t('ffmpeg.searching'));
    setError('');
    setFilesChecked(0);

    try {
      // Clear cache to force fresh search
      ffmpegFinder.clearCache();
      const result = await ffmpegFinder.findFFmpeg(true);
      
      setStatus({
        ffmpeg_found: !!result.ffmpeg?.isValid,
        ffprobe_found: !!result.ffprobe?.isValid,
        ffmpeg_path: cleanPath(result.ffmpeg?.path || ''),
        ffprobe_path: cleanPath(result.ffprobe?.path || ''),
        ffmpeg_version: result.ffmpeg?.version || '',
        ffprobe_version: result.ffprobe?.version || ''
      });
      setSearchStage('complete');
      
      if (!result.ffmpeg?.isValid || !result.ffprobe?.isValid) {
        setSearchStage('deep-search-warning');
      }
    } catch (err) {
      setError(String(err));
      setSearchStage('error');
    }
  };

  const handleDeepSearch = async () => {
    setSearchStage('deep-searching');
    setSearchMessage(t('ffmpeg.deepSearching'));
    setError('');
    setFilesChecked(0);

    try {
      const result = await invoke<FfmpegStatus>('search_ffmpeg_deep');
      // Clean paths from backend result
      setStatus({
        ...result,
        ffmpeg_path: cleanPath(result.ffmpeg_path),
        ffprobe_path: cleanPath(result.ffprobe_path)
      });
      setSearchStage('complete');
    } catch (err) {
      setError(String(err));
      setSearchStage('error');
    }
  };

  const handleSelectFfmpeg = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: 'FFmpeg',
          extensions: isWindows() ? ['exe'] : ['*']
        }
      ]
    });

    if (selected && typeof selected === 'string') {
      setCustomFfmpegPath(selected);
    }
  };

  const handleSelectFfprobe = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: 'FFprobe',
          extensions: isWindows() ? ['exe'] : ['*']
        }
      ]
    });

    if (selected && typeof selected === 'string') {
      setCustomFfprobePath(selected);
    }
  };

  const handleSetCustomPaths = async () => {
    if (!customFfmpegPath && !customFfprobePath) {
      setError(t('ffmpeg.selectAtLeastOne'));
      return;
    }

    try {
      const result = await ffmpegFinder.setManualPaths(
        customFfmpegPath || status?.ffmpeg_path || '',
        customFfprobePath || status?.ffprobe_path || ''
      );
      
      setStatus({
        ffmpeg_found: !!result.ffmpeg?.isValid,
        ffprobe_found: !!result.ffprobe?.isValid,
        ffmpeg_path: cleanPath(result.ffmpeg?.path || ''),
        ffprobe_path: cleanPath(result.ffprobe?.path || ''),
        ffmpeg_version: result.ffmpeg?.version || '',
        ffprobe_version: result.ffprobe?.version || ''
      });
      setCustomFfmpegPath('');
      setCustomFfprobePath('');
      setError('');
    } catch (err) {
      setError(String(err));
    }
  };

  const renderStatus = () => {
    if (!status) return null;

    const bothFound = status.ffmpeg_found && status.ffprobe_found;
    const statusClass = bothFound ? 'status-success' : 'status-warning';

    return (
      <div className={`ffmpeg-status ${statusClass}`}>
        <div className="status-item">
          <span className={status.ffmpeg_found ? 'status-icon-ok' : 'status-icon-missing'}>
            {status.ffmpeg_found ? '✓' : '✗'}
          </span>
          <div>
            <strong>FFmpeg:</strong>{' '}
            {status.ffmpeg_found ? (
              <>
                <span className="status-found">{t('ffmpeg.found')}</span>
                {/* Always show absolute path */}
                {status.ffmpeg_path && (
                  <div className="status-path" title={status.ffmpeg_path}>
                    {status.ffmpeg_path}
                  </div>
                )}
                {status.ffmpeg_version && (
                  <div className="status-version">{status.ffmpeg_version}</div>
                )}
              </>
            ) : (
              <span className="status-missing">{t('ffmpeg.notFound')}</span>
            )}
          </div>
        </div>

        <div className="status-item">
          <span className={status.ffprobe_found ? 'status-icon-ok' : 'status-icon-missing'}>
            {status.ffprobe_found ? '✓' : '✗'}
          </span>
          <div>
            <strong>FFprobe:</strong>{' '}
            {status.ffprobe_found ? (
              <>
                <span className="status-found">{t('ffmpeg.found')}</span>
                {/* Always show absolute path */}
                {status.ffprobe_path && (
                  <div className="status-path" title={status.ffprobe_path}>
                    {status.ffprobe_path}
                  </div>
                )}
                {status.ffprobe_version && (
                  <div className="status-version">{status.ffprobe_version}</div>
                )}
              </>
            ) : (
              <span className="status-missing">{t('ffmpeg.notFound')}</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="ffmpeg-manager">
      <h2>{t('ffmpeg.setup')}</h2>

      {renderStatus()}

      {error && <div className="error-message">{error}</div>}

      {searchStage === 'idle' && (!status?.ffmpeg_found || !status?.ffprobe_found) && (
        <div className="search-section">
          <p>{t('ffmpeg.required')}</p>
          <button onClick={handleFastSearch} className="btn-primary">
            {t('ffmpeg.autoSearch')}
          </button>
        </div>
      )}

      {searchStage === 'searching' && (
        <div className="search-progress">
          <div className="spinner"></div>
          <p>{searchMessage || t('ffmpeg.searching')}</p>
        </div>
      )}

      {searchStage === 'deep-search-warning' && (
        <div className="warning-box">
          <h3>{t('ffmpeg.fastSearchComplete')}</h3>
          <p>
            {status?.ffmpeg_found && !status?.ffprobe_found && t('ffmpeg.ffprobeNotFound')}
            {!status?.ffmpeg_found && status?.ffprobe_found && t('ffmpeg.ffmpegNotFound')}
            {!status?.ffmpeg_found && !status?.ffprobe_found && t('ffmpeg.bothNotFound')}
          </p>
          <p>
            {t('ffmpeg.deepSearchWarning')}
          </p>
          <div className="warning-actions">
            <button onClick={handleDeepSearch} className="btn-warning">
              {t('ffmpeg.startDeepSearch')}
            </button>
            <button onClick={() => setSearchStage('idle')} className="btn-secondary">
              {t('ffmpeg.cancel')}
            </button>
          </div>
        </div>
      )}

      {searchStage === 'deep-searching' && (
        <div className="search-progress deep">
          <div className="spinner large"></div>
          <p>{searchMessage || t('ffmpeg.deepSearching')}</p>
          {filesChecked > 0 && <p className="files-checked">{t('ffmpeg.checkedLocations').replace('{count}', String(filesChecked))}</p>}
          <p className="deep-warning">{t('ffmpeg.pleaseWait')}</p>
        </div>
      )}

      {searchStage === 'complete' && (
        <div className="search-complete">
          <p>{t('ffmpeg.searchComplete')}</p>
          <button onClick={() => setSearchStage('idle')} className="btn-secondary">
            {t('ffmpeg.ok')}
          </button>
        </div>
      )}

      <div className="manual-section">
        <h3>{t('ffmpeg.manualSetup')}</h3>
        <p className="help-text">
          {t('ffmpeg.manualSetupHelp')}
        </p>

        <div className="path-input-group">
          <label>{t('ffmpeg.ffmpegPath')}</label>
          <div className="path-input">
            <input
              type="text"
              value={customFfmpegPath || status?.ffmpeg_path || ''}
              onChange={(e) => setCustomFfmpegPath(e.target.value)}
              placeholder={t('ffmpeg.ffmpegPathPlaceholder')}
            />
            <button onClick={handleSelectFfmpeg} className="btn-browse">
              {t('ffmpeg.browse')}
            </button>
          </div>
        </div>

        <div className="path-input-group">
          <label>{t('ffmpeg.ffprobePath')}</label>
          <div className="path-input">
            <input
              type="text"
              value={customFfprobePath || status?.ffprobe_path || ''}
              onChange={(e) => setCustomFfprobePath(e.target.value)}
              placeholder={t('ffmpeg.ffprobePathPlaceholder')}
            />
            <button onClick={handleSelectFfprobe} className="btn-browse">
              {t('ffmpeg.browse')}
            </button>
          </div>
        </div>

        <button
          onClick={handleSetCustomPaths}
          className="btn-primary"
          disabled={!customFfmpegPath && !customFfprobePath}
        >
          {t('ffmpeg.savePaths')}
        </button>
      </div>

      <div className="help-section">
        <details>
          <summary>{t('ffmpeg.whereToGet')}</summary>
          <p>
            {t('ffmpeg.downloadFrom')} <a href="https://ffmpeg.org/download.html" target="_blank" rel="noopener noreferrer">
              ffmpeg.org/download.html
            </a>
          </p>
          <p>
            {t('ffmpeg.forWindows')} <a href="https://www.gyan.dev/ffmpeg/builds/" target="_blank" rel="noopener noreferrer">
              gyan.dev/ffmpeg/builds
            </a>
          </p>
        </details>
      </div>
    </div>
  );
}
