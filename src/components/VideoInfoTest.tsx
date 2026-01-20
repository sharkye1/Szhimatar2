import { useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { getVideoMetadata, VideoMetadata } from '../utils/ffmpeg';
import '../styles/VideoInfoTest.css';

/**
 * Test component for FFprobe integration
 * Allows selecting a video file and displaying its metadata
 */
export function VideoInfoTest() {
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSelectFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Video Files',
            extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v']
          }
        ]
      });

      if (selected && typeof selected === 'string') {
        setSelectedFile(selected);
        setError('');
        setMetadata(null);
      }
    } catch (err) {
      setError(`Failed to select file: ${err}`);
    }
  };

  const handleGetMetadata = async () => {
    if (!selectedFile) {
      setError('Please select a video file first');
      return;
    }

    setLoading(true);
    setError('');
    setMetadata(null);

    try {
      console.log('[VideoInfoTest] Getting metadata for:', selectedFile);
      const data = await getVideoMetadata(selectedFile);
      setMetadata(data);
      console.log('[VideoInfoTest] Metadata received:', data);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      console.error('[VideoInfoTest] Error:', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatBitrate = (kbps: number): string => {
    if (kbps >= 1000) {
      return `${(kbps / 1000).toFixed(2)} Mbps`;
    }
    return `${kbps} kbps`;
  };

  return (
    <div className="video-info-test">
      <h2>🎬 Video Metadata Test</h2>
      <p className="description">
        Test FFprobe integration by selecting a video file and viewing its metadata.
      </p>

      <div className="controls">
        <button onClick={handleSelectFile} className="btn-select">
          📁 Select Video File
        </button>

        {selectedFile && (
          <div className="selected-file">
            <strong>Selected:</strong>
            <span className="file-path" title={selectedFile}>
              {selectedFile.split(/[\\/]/).pop()}
            </span>
          </div>
        )}

        <button
          onClick={handleGetMetadata}
          disabled={!selectedFile || loading}
          className="btn-analyze"
        >
          {loading ? '⏳ Analyzing...' : '🔍 Get Metadata'}
        </button>
      </div>

      {error && (
        <div className="error-box">
          <strong>❌ Error:</strong>
          <p>{error}</p>
        </div>
      )}

      {metadata && (
        <div className="metadata-box">
          <h3>📊 Video Information</h3>
          
          <div className="metadata-grid">
            <div className="metadata-item">
              <span className="label">Codec:</span>
              <span className="value">{metadata.codec.toUpperCase()}</span>
            </div>

            <div className="metadata-item">
              <span className="label">Resolution:</span>
              <span className="value">{metadata.width} × {metadata.height}</span>
            </div>

            <div className="metadata-item">
              <span className="label">FPS:</span>
              <span className="value">{metadata.fps.toFixed(2)}</span>
            </div>

            <div className="metadata-item">
              <span className="label">Duration:</span>
              <span className="value">{formatDuration(metadata.duration)}</span>
            </div>

            <div className="metadata-item">
              <span className="label">Bitrate:</span>
              <span className="value">{formatBitrate(metadata.bitrate)}</span>
            </div>

            <div className="metadata-item">
              <span className="label">Total Frames:</span>
              <span className="value">
                {Math.round(metadata.duration * metadata.fps).toLocaleString()}
              </span>
            </div>
          </div>

          <div className="raw-data">
            <details>
              <summary>📄 Raw JSON Data</summary>
              <pre>{JSON.stringify(metadata, null, 2)}</pre>
            </details>
          </div>
        </div>
      )}

      <div className="instructions">
        <h4>ℹ️ Instructions:</h4>
        <ol>
          <li>Make sure FFprobe is configured in Settings</li>
          <li>Click "Select Video File" to choose a video</li>
          <li>Click "Get Metadata" to analyze the file</li>
          <li>View the extracted metadata below</li>
        </ol>
      </div>
    </div>
  );
}
