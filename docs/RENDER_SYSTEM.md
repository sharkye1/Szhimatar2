# Video Rendering System

## Overview

Complete FFmpeg-based video rendering system with:
- Queue management with multiple render modes (CPU/GPU/Duo)
- Real-time progress tracking and ETA calculation
- Hardware detection (CPU/GPU vendors) with visual feedback
- Parallel rendering scheduler for Duo Mode
- Statistics aggregation and persistence
- Preset management system

## Architecture

### Backend (Rust/Tauri)

- **ProcessManager** - Global manager for FFmpeg child processes with slot management
- **RenderJob** - Job definition with input/output paths and FFmpeg arguments
- **RenderProgress** - Progress data emitted via Tauri events
- **RenderResult** - Final result with success/error status
- **HardwareInfo** - CPU/GPU vendor detection via WMIC/lspci
- **StatisticsData** - Persistent statistics storage

### Frontend (TypeScript/React)

#### Services
- **RenderService** - Singleton service for queue management and job orchestration
- **RenderScheduler** - Intelligent scheduler for Duo Mode with CPU/GPU slot allocation
- **StatisticsService** - Statistics aggregation, calculation, and persistence
- **FFmpegFinder** - Automatic FFmpeg detection in system PATH and common locations

#### Components
- **RenderModeSelector** - Visual CPU/GPU/Duo selector with hardware-based gradients
- **StatisticsPanel** - Statistics visualization with charts and metrics
- **PresetManager** - User preset management (save/load/delete)
- **FfmpegManager** - FFmpeg path configuration UI

#### Hooks
- **useRenderQueue** - Main hook for render queue integration
- **useStatistics** - Hook for statistics data and operations
- **useFFmpegRenderer** - Low-level FFmpeg rendering hook

#### Builders
- **FFmpegCommandBuilder** - Builds FFmpeg args from VideoSettings/AudioSettings with codec mapping

## Key Features

### Core Rendering
1. **No Windows Console** - FFmpeg runs with `CREATE_NO_WINDOW` flag
2. **Real-time Progress** - Parsed from FFmpeg's `-progress pipe:1` output
3. **ETA Calculation** - Based on speed and remaining duration
4. **Queue Management** - Add, remove, start, pause, stop, clear jobs
5. **Event-driven** - Uses Tauri events for progress updates

### Render Modes
6. **CPU Mode** - Single-threaded CPU encoding
7. **GPU Mode** - Hardware-accelerated encoding (NVENC)
8. **Duo Mode** - Parallel CPU+GPU rendering with intelligent slot scheduling

### Hardware Detection
9. **Auto-detection** - Identifies CPU vendor (Intel/AMD) and GPU vendor (NVIDIA/AMD/Intel)
10. **Visual Feedback** - Dynamic gradients based on detected hardware
11. **Hardware Override** - Testing system for UI appearance without real hardware

### Statistics & Presets
12. **Statistics Tracking** - Aggregates render metrics (time, speed, compression ratio)
13. **Preset System** - Save/load user configurations
14. **Persistent Storage** - Settings, stats, and presets saved locally

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

### Backend (Rust)
- `src-tauri/src/main.rs` - Rust backend with FFmpeg commands and hardware detection
- `src-tauri/src/process_manager.rs` - Process management with slot allocation

### Services
- `src/services/RenderService.ts` - Queue management service with event emitters
- `src/services/RenderScheduler.ts` - Duo Mode scheduler with CPU/GPU slots
- `src/services/StatisticsService.ts` - Statistics aggregation and persistence
- `src/services/FFmpegFinder.ts` - FFmpeg discovery in system
- `src/services/__tests__/RenderScheduler.test.ts` - 35 unit tests for scheduler

### Hooks
- `src/hooks/useRenderQueue.ts` - Main React hook for render queue
- `src/hooks/useStatistics.ts` - Statistics hook
- `src/hooks/useFFmpegRenderer.tsx` - Low-level rendering hook

### Components
- `src/components/RenderModeSelector.tsx` - Visual mode selector
- `src/components/RenderModeSelector.css` - Animated styles with gradients
- `src/components/StatisticsPanel.tsx` - Statistics visualization
- `src/components/PresetManager.tsx` - Preset management UI
- `src/components/FfmpegManager.tsx` - FFmpeg configuration UI

### Pages
- `src/pages/MainWindow.tsx` - Main UI with queue, progress, and controls
- `src/pages/VideoSettings.tsx` - Video encoding settings
- `src/pages/AudioSettings.tsx` - Audio encoding settings
- `src/pages/GeneralSettings.tsx` - General app settings
- `src/pages/WatermarkSettings.tsx` - Watermark configuration

### Utilities
- `src/utils/ffmpeg.ts` - FFmpeg command builders and utilities
- `src/utils/statistics.ts` - Statistics calculation helpers
- `src/utils/logger.ts` - Logging utilities

### Configuration
- `.hardware-override.json` - Optional hardware override for testing (gitignored)
- `.hardware-override.*.json` - Example configurations for different hardware setups

### Documentation
- `DUO_MODE_GUIDE.md` - Duo Mode usage guide
- `STATISTICS_GUIDE.md` - Statistics system guide
- `HARDWARE_OVERRIDE_GUIDE.md` - Complete hardware override documentation
- `HARDWARE_OVERRIDE_QUICKSTART.md` - Quick start for testing
- `HARDWARE_OVERRIDE_RISKS.md` - Risk assessment and mitigation
- `HARDWARE_OVERRIDE_CHEATSHEET.md` - Command reference
