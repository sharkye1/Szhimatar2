import React, { useState, useEffect, useRef } from 'react';
import { FFmpegManager, type FFmpegJob, type FFmpegEvent } from '../utils/ffmpeg';
import styles from '../styles/components.module.css';

interface RenderingState {
  currentJobId: string | null;
  isRunning: boolean;
  isPaused: boolean;
  progress: number;
  frame: number;
  fps: number;
  time: string;
  bitrate: string;
  speed: number;
  queueLength: number;
  logs: string[];
}

export const FFmpegManagerTest: React.FC = () => {
  const [state, setState] = useState<RenderingState>({
    currentJobId: null,
    isRunning: false,
    isPaused: false,
    progress: 0,
    frame: 0,
    fps: 0,
    time: '00:00:00',
    bitrate: '0',
    speed: 0,
    queueLength: 0,
    logs: []
  });

  const managerRef = useRef(new FFmpegManager());
  const inputFileRef = useRef<string>('');
  const outputFileRef = useRef<string>('');

  useEffect(() => {
    const manager = managerRef.current;

    // Subscribe to events
    const handleEvent = (event: FFmpegEvent) => {
      // addLog(`[${event.type.toUpperCase()}] Job: ${event.jobId}`);

      setState(prev => {
        const newState = { ...prev };

        switch (event.type) {
          case 'start':
            newState.isRunning = true;
            newState.isPaused = false;
            newState.currentJobId = event.jobId;
            newState.progress = 0;
            break;

          case 'progress':
            if (event.progress) {
              newState.progress = event.progress.percentComplete;
              newState.frame = event.progress.frame;
              newState.fps = event.progress.fps;
              newState.time = event.progress.time;
              newState.bitrate = event.progress.bitrate;
              newState.speed = event.progress.speed;
            }
            break;

          case 'complete':
            newState.isRunning = false;
            newState.progress = 100;
            newState.currentJobId = null;
            // addLog('✅ Job completed successfully');
            break;

          case 'error':
            newState.isRunning = false;
            newState.currentJobId = null;
            // addLog(`❌ Error: ${event.error}`);
            break;

          case 'pause':
            newState.isPaused = true;
            // addLog('⏸ Job paused');
            break;

          case 'resume':
            newState.isPaused = false;
            // addLog('▶ Job resumed');
            break;
        }

        // Update queue status
        const status = manager.getQueueStatus();
        newState.queueLength = status.queueLength;

        return newState;
      });
    };

    manager.on(handleEvent);

    return () => {
      manager.off(handleEvent);
    };
  }, []);

  const addLog = (message: string) => {
    setState(prev => ({
      ...prev,
      logs: [...prev.logs.slice(-99), `[${new Date().toLocaleTimeString()}] ${message}`]
    }));
  };

  const handleStartJob = async () => {
    if (!inputFileRef.current || !outputFileRef.current) {
      addLog('❌ Please fill in input and output file paths');
      return;
    }

    const job: FFmpegJob = {
      jobId: `job-${Date.now()}`,
      input: inputFileRef.current,
      output: outputFileRef.current,
      videoSettings: {
        codec: 'libx264',
        bitrate: 5,
        fps: 30,
        resolution: '1280x720',
        crf: 23,
        preset: 'medium'
      },
      audioSettings: {
        codec: 'aac',
        bitrate: 128,
        channels: 2,
        sampleRate: 44100,
        volume: 1
      }
    };

    try {
      addLog(`📝 Starting job: ${job.jobId}`);
      await managerRef.current.start(job);
    } catch (error) {
      addLog(`❌ Failed to start job: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handlePause = async () => {
    try {
      await managerRef.current.pause();
    } catch (error) {
      addLog(`❌ Pause failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleResume = async () => {
    try {
      await managerRef.current.resume();
    } catch (error) {
      addLog(`❌ Resume failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleStop = async () => {
    try {
      await managerRef.current.stop();
      addLog('⛔ Job stopped');
    } catch (error) {
      addLog(`❌ Stop failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleClearQueue = () => {
    managerRef.current.clearQueue();
    setState(prev => ({ ...prev, queueLength: 0 }));
    addLog('🗑 Queue cleared');
  };

  const handleAddToQueue = async () => {
    if (!inputFileRef.current || !outputFileRef.current) {
      addLog('❌ Please fill in input and output file paths');
      return;
    }

    const job: FFmpegJob = {
      jobId: `job-${Date.now()}`,
      input: inputFileRef.current,
      output: `${outputFileRef.current.replace(/\.[^/.]+$/, '')}_${Date.now()}.mp4`,
      videoSettings: {
        codec: 'libx264',
        bitrate: 5,
        fps: 30,
        resolution: '1280x720',
        crf: 23,
        preset: 'medium'
      },
      audioSettings: {
        codec: 'aac',
        bitrate: 128,
        channels: 2,
        sampleRate: 44100,
        volume: 1
      }
    };

    try {
      addLog(`📝 Added job to queue: ${job.jobId}`);
      await managerRef.current.start(job);
    } catch (error) {
      addLog(`❌ Failed to add job: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className={styles.container}>
      <h2>FFmpegManager Test</h2>

      {/* Input Fields */}
      <div className={styles.section}>
        <h3>Job Configuration</h3>
        <div className={styles.formGroup}>
          <label>Input File Path:</label>
          <input
            type="text"
            placeholder="e.g., /path/to/video.mp4"
            onChange={e => (inputFileRef.current = e.target.value)}
            disabled={state.isRunning}
          />
        </div>

        <div className={styles.formGroup}>
          <label>Output File Path:</label>
          <input
            type="text"
            placeholder="e.g., /path/to/output.mp4"
            onChange={e => (outputFileRef.current = e.target.value)}
            disabled={state.isRunning}
          />
        </div>
      </div>

      {/* Status Display */}
      <div className={styles.section}>
        <h3>Status</h3>
        <div className={styles.statusGrid}>
          <div>
            <strong>Status:</strong>
            <span>
              {state.isRunning ? (state.isPaused ? '⏸ PAUSED' : '▶ RUNNING') : '⏹ IDLE'}
            </span>
          </div>
          <div>
            <strong>Current Job:</strong>
            <span>{state.currentJobId || 'None'}</span>
          </div>
          <div>
            <strong>Queue Length:</strong>
            <span>{state.queueLength}</span>
          </div>
          <div>
            <strong>Progress:</strong>
            <span>{state.progress}%</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className={styles.progressBar}>
          <div style={{ width: `${state.progress}%` }} />
        </div>

        {/* Detailed Metrics */}
        <div className={styles.metricsGrid}>
          <div>
            <strong>Frame:</strong>
            <span>{state.frame}</span>
          </div>
          <div>
            <strong>FPS:</strong>
            <span>{state.fps}</span>
          </div>
          <div>
            <strong>Time:</strong>
            <span>{state.time}</span>
          </div>
          <div>
            <strong>Bitrate:</strong>
            <span>{state.bitrate}</span>
          </div>
          <div>
            <strong>Speed:</strong>
            <span>{state.speed}x</span>
          </div>
        </div>
      </div>

      {/* Control Buttons */}
      <div className={styles.section}>
        <h3>Controls</h3>
        <div className={styles.buttonGroup}>
          <button onClick={handleStartJob} disabled={state.isRunning}>
            ▶ Start Job
          </button>
          <button
            onClick={handlePause}
            disabled={!state.isRunning || state.isPaused}
          >
            ⏸ Pause
          </button>
          <button
            onClick={handleResume}
            disabled={!state.isRunning || !state.isPaused}
          >
            ▶ Resume
          </button>
          <button
            onClick={handleStop}
            disabled={!state.isRunning}
          >
            ⛔ Stop
          </button>
          <button onClick={handleAddToQueue} disabled={state.isRunning}>
            ➕ Add to Queue
          </button>
          <button
            onClick={handleClearQueue}
            disabled={state.queueLength === 0}
          >
            🗑 Clear Queue
          </button>
        </div>
      </div>

      {/* Logs */}
      <div className={styles.section}>
        <h3>Logs</h3>
        <div className={styles.logBox}>
          {state.logs.map((log, index) => (
            <div key={index} className={styles.logLine}>
              {log}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FFmpegManagerTest;
