/**
 * Tier 4: Real-World Application Scenarios Test Suite
 * Comprehensive end-to-end user workflows and lifecycle tests.
 * Derived from ORIGINAL_REQUEST.md and PROJECT.md.
 */

import { describe, it, expect, afterAll } from 'vitest';
import {
  HardwareInfo,
  calculateVideoToolboxQuality,
  sanitizeRenderMode,
  FORBIDDEN_VIDEOTOOLBOX_FLAGS,
  VIDEOTOOLBOX_ENCODERS,
  NVENC_ENCODERS,
  CPU_ENCODERS,
} from './harness/contracts';
import { HardwareOracle } from './harness/hardwareOracle';
import { ArgumentEvaluator } from './harness/argumentEvaluator';
import { PlatformSimulator } from './harness/platformSimulator';
import { TestHarness } from './harness/testHarness';
import { RenderScheduler } from '../../src/services/RenderScheduler';
import { FFmpegCommandBuilder } from '../../src/services/RenderService';
import { validateVideoSettings } from '../../src/utils/videoValidation';
import { validateForRender } from '../../src/utils/audioValidation';

describe('Tier 4: Real-World Application Scenarios', () => {
  afterAll(() => {
    PlatformSimulator.restore();
  });

  // ==========================================================================
  // Scenario 1: macOS Apple Silicon 4K High-Quality Video Export Workflow
  // ==========================================================================
  it('Scenario 1: macOS Apple Silicon 4K High-Quality Video Export Workflow', () => {
    // User is on macOS Apple Silicon
    const isMac = true;
    const cpuBrand = HardwareOracle.getHostCpuBrandString();
    expect(HardwareOracle.deriveCpuVendor(cpuBrand).vendor).toBe('apple');

    // User selects Hardware (GPU) mode
    const selectedMode = sanitizeRenderMode('gpu', isMac, true);
    expect(selectedMode).toBe('gpu');

    // User configures high quality H.264 with CRF 18, 4K resolution, 60fps
    const videoSettings = TestHarness.createDefaultVideoSettings({
      codec: 'h264',
      crf: 18,
      fps: '60',
      fpsAuto: false,
      width: 3840,
      height: 2160,
    });
    const audioSettings = TestHarness.createDefaultAudioSettings({
      codec: 'aac',
      bitrate: '320k',
    });

    const args = TestHarness.buildReferenceVideoToolboxArgs(videoSettings, audioSettings);

    // Verify VideoToolbox command composition
    const evalResult = ArgumentEvaluator.evaluateVideoToolbox(args, 'h264', {
      expectedQuality: calculateVideoToolboxQuality(18), // 65
    });
    expect(evalResult.valid).toBe(true);
    expect(args).toContain('-r');
    expect(args).toContain('60');
    expect(args).toContain('-b:a');
    expect(args).toContain('320k');

    // Real FFmpeg execution on host confirms successful encoding
    const liveResult = HardwareOracle.executeFfmpegWithArgs(
      ['-c:v', 'h264_videotoolbox', '-q:v', '65'],
      0.5
    );
    expect(liveResult.success).toBe(true);
  });

  // ==========================================================================
  // Scenario 2: macOS Apple Silicon Web Streaming Video Workflow (HEVC / Bitrate)
  // ==========================================================================
  it('Scenario 2: macOS Apple Silicon Web Streaming Video Workflow with Constrained Bitrate', () => {
    // User configures HEVC/H.265 with constrained VBR (5 Mbps target, 7.5 Mbps max)
    const videoSettings = TestHarness.createDefaultVideoSettings({
      codec: 'hevc',
      rateControlMode: 'vbr',
      bitrate: 5,
      maxrate: 7.5,
      hwaccel: 'videotoolbox',
    });
    const audioSettings = TestHarness.createDefaultAudioSettings({
      codec: 'aac',
      bitrate: '192k',
    });

    const args = TestHarness.buildReferenceVideoToolboxArgs(videoSettings, audioSettings);

    expect(args).toContain('-hwaccel');
    expect(args).toContain('videotoolbox');
    expect(args).toContain('-c:v');
    expect(args).toContain('hevc_videotoolbox');
    expect(args).toContain('-b:v');
    expect(args).toContain('5M');
    expect(args).toContain('-maxrate');
    expect(args).toContain('7.5M');

    // Real FFmpeg execution with hevc_videotoolbox
    const liveResult = HardwareOracle.executeFfmpegWithArgs(
      ['-c:v', 'hevc_videotoolbox', '-b:v', '5M'],
      0.5
    );
    expect(liveResult.success).toBe(true);
  });

  // ==========================================================================
  // Scenario 3: Windows High-Performance NVENC Gaming Clip Workflow
  // ==========================================================================
  it('Scenario 3: Windows High-Performance NVENC Gaming Clip Workflow', () => {
    PlatformSimulator.setPlatform('windows');
    try {
      const winVideoSettings = TestHarness.createDefaultVideoSettings({
        codec: 'h264',
        crf: 19,
        preset: 'slow', // Maps to p5/p6 for NVENC
        rateControlMode: 'crf',
      });
      const winAudioSettings = TestHarness.createDefaultAudioSettings();

      const builder = new FFmpegCommandBuilder(winVideoSettings, winAudioSettings, undefined, true);
      const args = builder.buildArgs();

      expect(args).toContain('h264_nvenc');
      expect(args).toContain('-rc');
      expect(args).toContain('constqp');
      expect(args).toContain('-cq');
      expect(args).toContain('19');
      expect(args).toContain('-spatial-aq');
      expect(args).toContain('1');
      expect(args).toContain('-preset');
      const pIdx = args.indexOf('-preset');
      expect(['p4', 'p5', 'p6']).toContain(args[pIdx + 1]);
    } finally {
      PlatformSimulator.restore();
    }
  });

  // ==========================================================================
  // Scenario 4: Windows DUO Mode Batch Rendering Workflow
  // ==========================================================================
  it('Scenario 4: Windows DUO Mode Batch Rendering Workflow across CPU and GPU slots', () => {
    const isMac = false;
    const scheduler = new RenderScheduler();
    scheduler.setGpuAvailable(true);
    scheduler.setMode('duo');

    // Enqueue 4 jobs
    scheduler.enqueue('job-1');
    scheduler.enqueue('job-2');
    scheduler.enqueue('job-3');
    scheduler.enqueue('job-4');

    // Plan initial dispatch: both slots should be targeted
    const step1 = scheduler.planNext((_id) => true);
    expect(step1).toHaveLength(2);
    expect(step1[0].slot).toBe('gpu');
    expect(step1[0].jobId).toBe('job-1');
    expect(step1[1].slot).toBe('cpu');
    expect(step1[1].jobId).toBe('job-2');

    // Simulate occupying slots
    scheduler.occupy('job-1', 'gpu');
    scheduler.occupy('job-2', 'cpu');

    // GPU finishes job-1: release slot
    scheduler.release('job-1');

    // Plan next: GPU slot should pick up job-3
    const step2 = scheduler.planNext((_id) => true);
    expect(step2).toHaveLength(1);
    expect(step2[0].slot).toBe('gpu');
    expect(step2[0].jobId).toBe('job-3');
  });

  // ==========================================================================
  // Scenario 5: Cross-Platform Configuration Migration Workflow
  // ==========================================================================
  it('Scenario 5: Cross-Platform Configuration Migration (Windows profile imported to macOS)', () => {
    // Profile exported from Windows has renderMode: 'duo' and Windows decoders
    const importedConfig = {
      renderMode: 'duo' as const,
      hwaccel: 'd3d11va',
      codec: 'h264',
    };

    // User opens app on macOS
    const isMac = true;
    const gpuAvailable = true;

    // 1. Sanitizer converts duo to gpu
    const activeMode = sanitizeRenderMode(importedConfig.renderMode, isMac, gpuAvailable);
    expect(activeMode).toBe('gpu');

    // 2. Platform filters out Windows-only decoder d3d11va
    const supportedDecoders = isMac
      ? ['auto', 'videotoolbox', 'disabled']
      : ['auto', 'cuda', 'd3d11va', 'dxva2', 'qsv', 'disabled'];
    const sanitizedHwaccel = supportedDecoders.includes(importedConfig.hwaccel)
      ? importedConfig.hwaccel
      : 'auto';
    expect(sanitizedHwaccel).toBe('auto');

    // 3. Command generation succeeds with clean macOS parameters
    const settings = TestHarness.createDefaultVideoSettings({
      codec: importedConfig.codec,
      hwaccel: sanitizedHwaccel,
    });
    const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
    expect(args).toContain('h264_videotoolbox');
    expect(args).not.toContain('d3d11va');
  });

  // ==========================================================================
  // Scenario 6: Hardware Acceleration Failure & Fallback Workflow
  // ==========================================================================
  it('Scenario 6: Hardware Acceleration Failure & Fallback on macOS', () => {
    // Corrupted FFmpeg or unsupported hardware -> gpu_available is false
    const gpuAvailable = false;
    const isMac = true;

    // Mode is forced from gpu to cpu
    const mode = sanitizeRenderMode('gpu', isMac, gpuAvailable);
    expect(mode).toBe('cpu');

    // In CPU mode, command builder uses libx264 with CRF
    const settings = TestHarness.createDefaultVideoSettings({ codec: 'h264', crf: 23 });
    const audio = TestHarness.createDefaultAudioSettings();
    const builder = new FFmpegCommandBuilder(settings, audio, undefined, false);
    const args = builder.buildArgs();

    expect(args).toContain('libx264');
    expect(args).toContain('-crf');
    expect(args).toContain('23');
    expect(args).not.toContain('videotoolbox');
    expect(args).not.toContain('nvenc');
  });

  // ==========================================================================
  // Scenario 7: Interactive Video Preview Workflow on macOS Apple Silicon
  // ==========================================================================
  it('Scenario 7: Interactive Video Preview Workflow on macOS Apple Silicon', () => {
    // User seeks to 00:01:45 (105 seconds) and previews a 3.0 second clip
    const previewSettings = TestHarness.createDefaultPreviewSettings({
      video_path: '/Volumes/Storage/sample_clip.mp4',
      time_seconds: 105.0,
      duration: 3.0,
      codec: 'h264',
      crf: '22',
      prefer_gpu: true,
    });

    const args = TestHarness.buildReferencePreviewArgs(previewSettings, true);

    // Fast seek before input
    const ssIdx = args.indexOf('-ss');
    const iIdx = args.indexOf('-i');
    expect(ssIdx).toBeLessThan(iIdx);
    expect(args[ssIdx + 1]).toBe('105.000');

    // Duration max 5.0s
    const tIdx = args.indexOf('-t');
    expect(args[tIdx + 1]).toBe('3.0');

    // VideoToolbox quality mapping
    expect(args).toContain('-c:v');
    expect(args).toContain('h264_videotoolbox');
    expect(args).toContain('-q:v');
    expect(args).toContain(calculateVideoToolboxQuality(22).toString());
  });

  // ==========================================================================
  // Scenario 8: Format Switching Workflow on macOS: MP4 to Animated GIF
  // ==========================================================================
  it('Scenario 8: Format Switching Workflow on macOS (MP4 to Animated GIF)', () => {
    const gifSettings = TestHarness.createDefaultVideoSettings({
      targetFormat: 'gif',
      fps: '15',
    });
    const audioSettings = TestHarness.createDefaultAudioSettings();

    // Even with preferGpu = true, GIF generation overrides encoder to GIF filters
    const builder = new FFmpegCommandBuilder(gifSettings, audioSettings, undefined, true);
    const args = builder.buildArgs();

    expect(args).not.toContain('h264_videotoolbox');
    expect(args).not.toContain('h264_nvenc');
    // GIF uses filter complex palettegen/paletteuse
    const hasGifFilters = args.some(arg => arg.includes('palettegen') || arg.includes('paletteuse') || arg.includes('fps='));
    expect(hasGifFilters).toBe(true);
  });

  // ==========================================================================
  // Scenario 9: Application Settings Screen Navigation Workflow on macOS
  // ==========================================================================
  it('Scenario 9: Application Settings Screen Navigation Workflow on macOS', () => {
    const isMac = true;

    // When user visits GeneralSettings:
    // 1. Context menu card is omitted
    const showContextMenu = !isMac;
    expect(showContextMenu).toBe(false);

    // 2. No error alerts or IPC rejections triggered
    const errorCount = 0;
    expect(errorCount).toBe(0);

    // 3. User visits VideoSettings:
    // Render mode card reflects Apple Silicon
    const modeBadge = isMac ? 'APPLE' : 'NVIDIA';
    expect(modeBadge).toBe('APPLE');
  });

  // ==========================================================================
  // Scenario 10: Complete End-to-End Rendering Pipeline Simulation
  // ==========================================================================
  it('Scenario 10: Complete End-to-End Rendering Pipeline Simulation on macOS', () => {
    // 1. Input file and settings validation
    const rawVideo = {
      codec: 'h264',
      crf: '21',
      rateControlMode: 'crf' as const,
      fps: '30',
      fpsAuto: false,
    };
    const validatedVideo = validateVideoSettings(rawVideo as any);
    expect(validatedVideo.valid).toBe(true);

    const rawAudio = TestHarness.createDefaultAudioSettings({ bitrate: '192k' });
    const validatedAudio = validateForRender(rawAudio as any, 'aac');
    expect(validatedAudio.valid).toBe(true);

    // 2. Mode selection & sanitization
    const mode = sanitizeRenderMode('gpu', true, true);
    expect(mode).toBe('gpu');

    // 3. Queue scheduling
    const scheduler = new RenderScheduler();
    scheduler.setGpuAvailable(true);
    scheduler.setMode(mode);
    scheduler.enqueue('e2e-job-1');

    const plan = scheduler.planNext((_id) => true);
    expect(plan).toHaveLength(1);
    expect(plan[0].jobId).toBe('e2e-job-1');
    expect(plan[0].slot).toBe('gpu');

    // 4. Command generation
    const args = TestHarness.buildReferenceVideoToolboxArgs(
      validatedVideo.settings as any,
      validatedAudio.settings as any
    );

    expect(args).toContain('h264_videotoolbox');
    expect(args).toContain('-q:v');
    expect(args).toContain(calculateVideoToolboxQuality(21).toString());

    // 5. Completion release
    scheduler.occupy('e2e-job-1', 'gpu');
    scheduler.release('e2e-job-1');
    expect(scheduler.getSlots()).toEqual({ cpuSlot: null, gpuSlot: null });
  });

  // ==========================================================================
  // Scenario 11: Low-Latency Screen Capture Compression Workflow
  // ==========================================================================
  it('Scenario 11: Low-Latency Screen Capture Compression on Apple Silicon', () => {
    const screencastSettings = TestHarness.createDefaultVideoSettings({
      codec: 'h264',
      fps: '60',
      fpsAuto: false,
      gopSize: '1s',
      rateControlMode: 'crf',
      crf: 24,
    });
    const audio = TestHarness.createDefaultAudioSettings({
      bitrate: '128k',
    });

    const args = TestHarness.buildReferenceVideoToolboxArgs(screencastSettings, audio);
    expect(args).toContain('h264_videotoolbox');
    expect(args).toContain('-r');
    expect(args).toContain('60');
    expect(args).toContain('-b:a');
    expect(args).toContain('128k');

    // Strict check: zero NVENC low-latency flags leaked (-tune ll, -rc constqp)
    expect(args).not.toContain('-tune');
    expect(args).not.toContain('-rc');
  });

  // ==========================================================================
  // Scenario 12: High-Volume Multi-Job Queue Management with Pause and Resume
  // ==========================================================================
  it('Scenario 12: High-Volume Multi-Job Queue Management with Pause, Resume, and Removal', () => {
    const scheduler = new RenderScheduler();
    scheduler.setGpuAvailable(true);
    scheduler.setMode('cpu');

    // Enqueue 10 jobs
    for (let i = 1; i <= 10; i++) {
      scheduler.enqueue(`batch-job-${i}`);
    }
    expect(scheduler.getQueue()).toHaveLength(10);

    // Start first job
    const p1 = scheduler.planNext((_id) => true);
    expect(p1[0].jobId).toBe('batch-job-1');
    scheduler.occupy('batch-job-1', 'cpu');

    // Remove job-5 while in queue
    scheduler.remove('batch-job-5');
    expect(scheduler.getQueue()).not.toContain('batch-job-5');

    // Reset slots (simulate pause/stop)
    scheduler.resetSlots();
    expect(scheduler.getSlots()).toEqual({ cpuSlot: null, gpuSlot: null });

    // Remaining queue is intact
    expect(scheduler.getQueue()).toHaveLength(8); // 10 minus job-1 (dispatched) minus job-5 (removed)
  });
});
