# Video Rendering System

## Overview

Complete FFmpeg-based video rendering system with queue management, real-time progress tracking, and ETA calculation.

## Architecture

### Backend (Rust/Tauri)

- **ProcessManager** - Global manager for FFmpeg child processes
- **RenderJob** - Job definition with input/output paths and FFmpeg arguments
- **RenderProgress** - Progress data emitted via Tauri events
- **RenderResult** - Final result with success/error status

### Frontend (TypeScript/React)

- **RenderService** - Singleton service for queue management
- **FFmpegCommandBuilder** - Builds FFmpeg args from VideoSettings/AudioSettings
- **useRenderQueue** - React hook for easy integration

## Key Features

1. **No Windows Console** - FFmpeg runs with `CREATE_NO_WINDOW` flag
2. **Real-time Progress** - Parsed from FFmpeg's `-progress pipe:1` output
3. **ETA Calculation** - Based on speed and remaining duration
4. **Queue Management** - Add, remove, start, pause, stop jobs
5. **Event-driven** - Uses Tauri events for progress updates

## Usage

### Basic Usage

```tsx
import useRenderQueue from './hooks/useRenderQueue';

function MyComponent() {
  const {
    jobs,
    isProcessing,
    addFiles,
    start,
    pause,
    stop,
    updateSettings,
  } = useRenderQueue();

  // Update settings before starting
  useEffect(() => {
    updateSettings(videoSettings, audioSettings, watermarkSettings, mainScreenSettings);
  }, [videoSettings, audioSettings]);

  // Add files to queue
  const handleAddFiles = async () => {
    const files = await selectFiles();
    await addFiles(files);
  };

  // Start processing
  const handleStart = () => {
    start();
  };

  return (
    <div>
      {jobs.map(job => (
        <div key={job.id}>
          <span>{job.fileName}</span>
          <span>{job.progress.toFixed(1)}%</span>
          <span>ETA: {job.etaFormatted}</span>
        </div>
      ))}
    </div>
  );
}
```

### Tauri Commands

```typescript
// Start render
await invoke('run_ffmpeg_render', {
  job: {
    job_id: 'unique-id',
    input_path: '/path/to/input.mp4',
    output_path: '/path/to/output.mp4',
    ffmpeg_args: ['-c:v', 'libx264', '-crf', '23'],
    duration_seconds: 120.5,
  }
});

// Stop specific job
await invoke('stop_ffmpeg_render', { jobId: 'unique-id' });

// Stop all jobs
await invoke('stop_all_renders');

// Get video duration
const duration = await invoke('get_video_duration', { inputPath: '/path/to/video.mp4' });
```

### Tauri Events

```typescript
import { listen } from '@tauri-apps/api/event';

// Progress updates
await listen('render-progress', (event) => {
  const progress = event.payload as RenderProgress;
  console.log(`Job ${progress.job_id}: ${progress.progress_percent}%`);
});

// Job complete
await listen('render-complete', (event) => {
  const jobId = event.payload as string;
  console.log(`Job ${jobId} completed`);
});

// Job error
await listen('render-error', (event) => {
  const { job_id, error } = event.payload;
  console.error(`Job ${job_id} failed: ${error}`);
});
```

## RenderProgress Object

```typescript
interface RenderProgress {
  job_id: string;
  frame: number;        // Current frame
  fps: number;          // Encoding FPS
  bitrate: string;      // e.g., "5000kbits/s"
  total_size: string;   // Current output size
  time_seconds: number; // Current time in video
  speed: number;        // Encoding speed (1.0 = realtime)
  progress_percent: number; // 0-100
  eta_seconds: number;  // Estimated time remaining
}
```

## FFmpegCommandBuilder

Automatically converts settings to FFmpeg arguments:

- Video codec mapping (h264 → libx264, hevc → libx265, etc.)
- Audio codec mapping (aac, mp3 → libmp3lame, opus → libopus)
- Bitrate, CRF, preset configuration
- Video filters: scale, rotation, flip, deinterlace, denoise, sharpen
- Audio filters: volume, gain, normalization, EQ, noise reduction
- Speed adjustment with proper PTS modification

## Files

- `src-tauri/src/main.rs` - Rust backend with FFmpeg commands
- `src/services/RenderService.ts` - Queue management service
- `src/hooks/useRenderQueue.ts` - React hook
- `src/pages/MainWindow.tsx` - Updated UI with progress/ETA
