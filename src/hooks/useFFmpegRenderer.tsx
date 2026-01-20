import React, { useEffect, useRef, useState } from 'react';
import { FFmpegManager, type FFmpegJob, type FFmpegEvent } from '../utils/ffmpeg';

/**
 * Hook for managing FFmpeg rendering
 * Provides simple API for video compression with progress tracking
 */
export const useFFmpegRenderer = () => {
  const managerRef = useRef(new FFmpegManager());
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const manager = managerRef.current;

    const handleEvent = (event: FFmpegEvent) => {
      switch (event.type) {
        case 'start':
          setIsRendering(true);
          setCurrentJobId(event.jobId);
          setProgress(0);
          setError(null);
          break;

        case 'progress':
          if (event.progress) {
            setProgress(event.progress.percentComplete);
          }
          break;

        case 'complete':
          setIsRendering(false);
          setProgress(100);
          setCurrentJobId(null);
          break;

        case 'error':
          setIsRendering(false);
          setError(event.error || 'Unknown error');
          setCurrentJobId(null);
          break;

        case 'pause':
          // Progress bar visual feedback
          break;

        case 'resume':
          // Resume progress
          break;
      }
    };

    manager.on(handleEvent);
    return () => manager.off(handleEvent);
  }, []);

  const compressVideo = async (
    inputPath: string,
    outputPath: string,
    options?: {
      videoCodec?: string;
      videoBitrate?: number;
      fps?: number;
      resolution?: string;
      crf?: number;
      preset?: string;
      audioCodec?: string;
      audioBitrate?: number;
    }
  ) => {
    const job: FFmpegJob = {
      jobId: `render-${Date.now()}`,
      input: inputPath,
      output: outputPath,
      videoSettings: {
        codec: options?.videoCodec || 'libx264',
        bitrate: options?.videoBitrate || 5,
        fps: options?.fps || 30,
        resolution: options?.resolution || '1280x720',
        crf: options?.crf || 23,
        preset: options?.preset || 'medium'
      },
      audioSettings: {
        codec: options?.audioCodec || 'aac',
        bitrate: options?.audioBitrate || 128,
        channels: 2,
        sampleRate: 44100,
        volume: 1
      }
    };

    return managerRef.current.start(job);
  };

  const pauseRendering = () => managerRef.current.pause();
  const resumeRendering = () => managerRef.current.resume();
  const stopRendering = () => managerRef.current.stop();
  const getQueueStatus = () => managerRef.current.getQueueStatus();

  return {
    compressVideo,
    pauseRendering,
    resumeRendering,
    stopRendering,
    getQueueStatus,
    isRendering,
    progress,
    currentJobId,
    error
  };
};

/**
 * Simple progress display component
 */
export const FFmpegProgressDisplay: React.FC<{
  isRendering: boolean;
  progress: number;
  error?: string | null;
}> = ({ isRendering, progress, error }) => {
  return (
    <div style={{ padding: '1rem', borderRadius: '8px', background: '#f5f5f5' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        {error ? (
          <span style={{ color: '#d32f2f' }}>❌ Error: {error}</span>
        ) : isRendering ? (
          <span style={{ color: '#1976d2' }}>▶ Rendering: {progress}%</span>
        ) : progress === 100 ? (
          <span style={{ color: '#388e3c' }}>✅ Complete</span>
        ) : (
          <span>⏹ Idle</span>
        )}
      </div>
      <div style={{
        height: '8px',
        background: '#ddd',
        borderRadius: '4px',
        overflow: 'hidden'
      }}>
        <div
          style={{
            height: '100%',
            background: error ? '#d32f2f' : '#1976d2',
            width: `${progress}%`,
            transition: 'width 0.3s ease'
          }}
        />
      </div>
    </div>
  );
};

/**
 * Example usage in a component
 */
export const VideoCompressionExample: React.FC = () => {
  const {
    compressVideo,
    pauseRendering,
    resumeRendering,
    stopRendering,
    isRendering,
    progress,
    error
  } = useFFmpegRenderer();

  const handleCompress = async () => {
    await compressVideo(
      '/path/to/input.mp4',
      '/path/to/output.mp4',
      {
        videoCodec: 'libx264',
        videoBitrate: 5,
        fps: 30,
        resolution: '1280x720',
        crf: 23,
        preset: 'medium'
      }
    );
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '500px' }}>
      <h2>Video Compression</h2>
      
      <FFmpegProgressDisplay
        isRendering={isRendering}
        progress={progress}
        error={error}
      />

      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
        <button onClick={handleCompress} disabled={isRendering}>
          Start Compression
        </button>
        <button onClick={pauseRendering} disabled={!isRendering}>
          Pause
        </button>
        <button onClick={resumeRendering} disabled={!isRendering}>
          Resume
        </button>
        <button onClick={stopRendering} disabled={!isRendering}>
          Stop
        </button>
      </div>

      {error && (
        <div style={{
          marginTop: '1rem',
          padding: '0.5rem',
          background: '#ffebee',
          color: '#c62828',
          borderRadius: '4px'
        }}>
          {error}
        </div>
      )}
    </div>
  );
};
