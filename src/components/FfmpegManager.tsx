import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/api/dialog';
import { ffmpegFinder } from '../services/FFmpegFinder';
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

export function FfmpegManager() {
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
        ffmpeg_path: result.ffmpeg?.path || '',
        ffprobe_path: result.ffprobe?.path || '',
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
    setSearchMessage('Searching for FFmpeg...');
    setError('');
    setFilesChecked(0);

    try {
      // Clear cache to force fresh search
      ffmpegFinder.clearCache();
      const result = await ffmpegFinder.findFFmpeg(true);
      
      setStatus({
        ffmpeg_found: !!result.ffmpeg?.isValid,
        ffprobe_found: !!result.ffprobe?.isValid,
        ffmpeg_path: result.ffmpeg?.path || '',
        ffprobe_path: result.ffprobe?.path || '',
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
    setSearchMessage('Starting deep search...');
    setError('');
    setFilesChecked(0);

    try {
      const result = await invoke<FfmpegStatus>('search_ffmpeg_deep');
      setStatus(result);
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
      setError('Please select at least one path');
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
        ffmpeg_path: result.ffmpeg?.path || '',
        ffprobe_path: result.ffprobe?.path || '',
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
                <span className="status-found">Found</span>
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
              <span className="status-missing">Not found</span>
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
                <span className="status-found">Found</span>
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
              <span className="status-missing">Not found</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="ffmpeg-manager">
      <h2>FFmpeg Setup</h2>

      {renderStatus()}

      {error && <div className="error-message">{error}</div>}

      {searchStage === 'idle' && (!status?.ffmpeg_found || !status?.ffprobe_found) && (
        <div className="search-section">
          <p>FFmpeg is required for video compression. Let's find it!</p>
          <button onClick={handleFastSearch} className="btn-primary">
            🔍 Auto-Search for FFmpeg
          </button>
        </div>
      )}

      {searchStage === 'searching' && (
        <div className="search-progress">
          <div className="spinner"></div>
          <p>{searchMessage || 'Searching...'}</p>
        </div>
      )}

      {searchStage === 'deep-search-warning' && (
        <div className="warning-box">
          <h3>⚠️ Fast Search Complete</h3>
          <p>
            {status?.ffmpeg_found && !status?.ffprobe_found && 'FFprobe not found in common locations.'}
            {!status?.ffmpeg_found && status?.ffprobe_found && 'FFmpeg not found in common locations.'}
            {!status?.ffmpeg_found && !status?.ffprobe_found && 'FFmpeg and FFprobe not found in common locations.'}
          </p>
          <p>
            <strong>Deep search</strong> will scan your entire computer. This may take several minutes
            and could slow down your system.
          </p>
          <div className="warning-actions">
            <button onClick={handleDeepSearch} className="btn-warning">
              🔎 Start Deep Search
            </button>
            <button onClick={() => setSearchStage('idle')} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {searchStage === 'deep-searching' && (
        <div className="search-progress deep">
          <div className="spinner large"></div>
          <p>{searchMessage || 'Deep searching...'}</p>
          {filesChecked > 0 && <p className="files-checked">Checked {filesChecked} locations</p>}
          <p className="deep-warning">This may take a while. Please be patient...</p>
        </div>
      )}

      {searchStage === 'complete' && (
        <div className="search-complete">
          <p>✓ Search complete!</p>
          <button onClick={() => setSearchStage('idle')} className="btn-secondary">
            OK
          </button>
        </div>
      )}

      <div className="manual-section">
        <h3>Manual Setup</h3>
        <p className="help-text">
          If auto-search doesn't work, you can manually specify the paths to FFmpeg and FFprobe binaries.
        </p>

        <div className="path-input-group">
          <label>FFmpeg Path:</label>
          <div className="path-input">
            <input
              type="text"
              value={customFfmpegPath || status?.ffmpeg_path || ''}
              onChange={(e) => setCustomFfmpegPath(e.target.value)}
              placeholder="/path/to/ffmpeg or C:\ffmpeg\bin\ffmpeg.exe"
            />
            <button onClick={handleSelectFfmpeg} className="btn-browse">
              Browse...
            </button>
          </div>
        </div>

        <div className="path-input-group">
          <label>FFprobe Path:</label>
          <div className="path-input">
            <input
              type="text"
              value={customFfprobePath || status?.ffprobe_path || ''}
              onChange={(e) => setCustomFfprobePath(e.target.value)}
              placeholder="/path/to/ffprobe or C:\ffmpeg\bin\ffprobe.exe"
            />
            <button onClick={handleSelectFfprobe} className="btn-browse">
              Browse...
            </button>
          </div>
        </div>

        <button
          onClick={handleSetCustomPaths}
          className="btn-primary"
          disabled={!customFfmpegPath && !customFfprobePath}
        >
          Save Paths
        </button>
      </div>

      <div className="help-section">
        <details>
          <summary>Where to get FFmpeg?</summary>
          <p>
            Download FFmpeg from: <a href="https://ffmpeg.org/download.html" target="_blank" rel="noopener noreferrer">
              ffmpeg.org/download.html
            </a>
          </p>
          <p>
            For Windows, you can also use: <a href="https://www.gyan.dev/ffmpeg/builds/" target="_blank" rel="noopener noreferrer">
              gyan.dev/ffmpeg/builds
            </a>
          </p>
        </details>
      </div>
    </div>
  );
}
