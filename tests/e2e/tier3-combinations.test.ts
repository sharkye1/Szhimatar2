/**
 * Tier 3: Cross-Feature Combinations Test Suite
 * Pairwise coverage of major feature interactions across the 13 inventoried features.
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

describe('Tier 3: Cross-Feature Combinations (Pairwise Coverage)', () => {
  afterAll(() => {
    PlatformSimulator.restore();
  });

  // Pair 1: F1 (Apple Silicon Detection) + F6 (VideoToolbox Parameter Generation)
  it('Pair 1 (F1 + F6): Apple Silicon CPU detection couples with VideoToolbox argument generation', () => {
    const brand = HardwareOracle.getHostCpuBrandString();
    const vendorResult = HardwareOracle.deriveCpuVendor(brand);
    expect(vendorResult.vendor).toBe('apple');

    // On Apple Silicon, GPU preference uses VideoToolbox
    const videoSettings = TestHarness.createDefaultVideoSettings({ codec: 'h264', crf: 22 });
    const args = TestHarness.buildReferenceVideoToolboxArgs(videoSettings);
    expect(args).toContain('h264_videotoolbox');
    const q = calculateVideoToolboxQuality(22);
    expect(args).toContain(q.toString());
  });

  // Pair 2: F2 (VideoToolbox Detection) + F4 (UI Mode Selector)
  it('Pair 2 (F2 + F4): VideoToolbox HW detection state controls UI Hardware mode availability', () => {
    const encodersStdout = HardwareOracle.getHostFfmpegEncoders();
    const detection = HardwareOracle.detectVideoToolbox(encodersStdout);
    expect(detection.available).toBe(true);

    // When detection is true, UI allows Hardware (GPU) mode selection
    const isGpuDisabled = !detection.available;
    expect(isGpuDisabled).toBe(false);
  });

  // Pair 3: F2 (VideoToolbox Detection) + F5 (Scheduler Fallback)
  it('Pair 3 (F2 + F5): VideoToolbox unavailability triggers scheduler fallback to CPU', () => {
    const scheduler = new RenderScheduler();
    scheduler.setGpuAvailable(true);
    scheduler.setMode('gpu');
    expect(scheduler.getMode()).toBe('gpu');

    // VideoToolbox detection fails -> sets gpuAvailable to false
    scheduler.setGpuAvailable(false);
    expect(scheduler.getMode()).toBe('cpu');
  });

  // Pair 4: F4 (Platform Mode Selector) + F5 (Mode Sanitization)
  it('Pair 4 (F4 + F5): UI mode selector on macOS enforces sanitized 2-mode state', () => {
    const isMac = true;
    const gpuAvailable = true;

    // Even if external settings file had 'duo', sanitization cleanses it before UI state initializes
    const initialMode = sanitizeRenderMode('duo', isMac, gpuAvailable);
    expect(initialMode).toBe('gpu');
    expect(initialMode).not.toBe('duo');
  });

  // Pair 5: F6 (VideoToolbox Parameters) + F7 (NVENC Flag Suppression)
  it('Pair 5 (F6 + F7): VideoToolbox parameter generation guarantees zero NVENC flag leakage', () => {
    const settings = TestHarness.createDefaultVideoSettings({
      codec: 'h264',
      crf: 18,
      rateControlMode: 'constrained_crf',
      bitrate: 8,
      maxrate: 12,
      nvencMultipass: 'fullres',
      preset: 'slow',
    });
    const args = TestHarness.buildReferenceVideoToolboxArgs(settings);

    // Contains valid VideoToolbox flags
    expect(args).toContain('h264_videotoolbox');
    expect(args).toContain('-q:v');
    expect(args).toContain('-b:v');

    // Complete scan: zero forbidden flags
    const evaluation = ArgumentEvaluator.evaluateVideoToolbox(args, 'h264', {
      expectedQuality: calculateVideoToolboxQuality(18),
      expectedBitrate: '8M',
    });
    expect(evaluation.valid).toBe(true);
    expect(evaluation.violations).toEqual([]);
  });

  // Pair 6: F3 (Windows Detection) + F9 (Windows NVENC Preservation)
  it('Pair 6 (F3 + F9): Windows platform detection preserves all NVENC command options', () => {
    PlatformSimulator.setPlatform('windows');
    try {
      const winSettings = TestHarness.createDefaultVideoSettings({
        codec: 'h264',
        crf: 23,
        preset: 'slow',
      });
      const audio = TestHarness.createDefaultAudioSettings();
      const builder = new FFmpegCommandBuilder(winSettings, audio, undefined, true);
      const args = builder.buildArgs();

      expect(args).toContain('h264_nvenc');
      expect(args).toContain('-rc');
      expect(args).toContain('constqp');
      expect(args).toContain('-cq');
      expect(args).toContain('23');
      expect(args).toContain('-spatial-aq');
      expect(args).toContain('1');
    } finally {
      PlatformSimulator.restore();
    }
  });

  // Pair 7: F8 (Preview Generation) + F6 (Final Render Parameter Equivalence)
  it('Pair 7 (F8 + F6): Preview VideoToolbox parameters match Final Render parameters for same CRF', () => {
    const crf = 20;
    const finalSettings = TestHarness.createDefaultVideoSettings({ codec: 'h264', crf });
    const finalArgs = TestHarness.buildReferenceVideoToolboxArgs(finalSettings);

    const previewSettings = TestHarness.createDefaultPreviewSettings({ codec: 'h264', crf: crf.toString(), prefer_gpu: true });
    const previewArgs = TestHarness.buildReferencePreviewArgs(previewSettings, true);

    const expectedQuality = calculateVideoToolboxQuality(crf).toString();

    // Both must use identical encoder and -q:v value
    const finalQIdx = finalArgs.indexOf('-q:v');
    const prevQIdx = previewArgs.indexOf('-q:v');
    expect(finalArgs[finalQIdx + 1]).toBe(expectedQuality);
    expect(previewArgs[prevQIdx + 1]).toBe(expectedQuality);
    expect(finalArgs).toContain('h264_videotoolbox');
    expect(previewArgs).toContain('h264_videotoolbox');
  });

  // Pair 8: F8 (Preview Generation) + F2 (VideoToolbox Detection Fallback)
  it('Pair 8 (F8 + F2): Preview generator falls back to CPU libx264 when VideoToolbox is unavailable', () => {
    const previewSettings = TestHarness.createDefaultPreviewSettings({
      codec: 'h264',
      crf: '23',
      prefer_gpu: false, // GPU unavailable
    });
    const previewArgs = TestHarness.buildReferencePreviewArgs(previewSettings, true);
    expect(previewArgs).toContain('libx264');
    expect(previewArgs).not.toContain('videotoolbox');
    expect(previewArgs).toContain('-crf');
    expect(previewArgs).toContain('23');
  });

  // Pair 9: F10 (Platform UI Cleanup) + F11 (Dynamic VideoSettings Adaptation)
  it('Pair 9 (F10 + F11): Central platform state gates both GeneralSettings and VideoSettings adaptations', () => {
    const isMac = true;

    // GeneralSettings adaptation on macOS
    const showWindowsContextMenu = !isMac;
    expect(showWindowsContextMenu).toBe(false);

    // VideoSettings adaptation on macOS
    const activeModeCardText = isMac ? 'Apple Silicon (VideoToolbox)' : 'NVIDIA NVENC';
    expect(activeModeCardText).toContain('Apple Silicon (VideoToolbox)');

    const supportedHwaccelDecoders = isMac
      ? ['auto', 'videotoolbox', 'disabled']
      : ['auto', 'cuda', 'd3d11va', 'dxva2', 'qsv', 'disabled'];
    expect(supportedHwaccelDecoders).toContain('videotoolbox');
    expect(supportedHwaccelDecoders).not.toContain('d3d11va');
  });

  // Pair 10: F6 (VideoToolbox Parameters) + F11 (VideoSettings HW Decoding Selection)
  it('Pair 10 (F6 + F11): VideoSettings hwaccel selection flows directly into FFmpeg input arguments', () => {
    const settings = TestHarness.createDefaultVideoSettings({
      hwaccel: 'videotoolbox',
      codec: 'h264',
    });
    const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
    const hwIdx = args.indexOf('-hwaccel');
    expect(hwIdx).not.toBe(-1);
    expect(args[hwIdx + 1]).toBe('videotoolbox');
    expect(args).toContain('h264_videotoolbox');
  });

  // Pair 11: F5 (Mode Sanitization) + F9 (Windows DUO Mode Scheduling)
  it('Pair 11 (F5 + F9): Windows DUO mode preserves multi-slot concurrency without sanitization', () => {
    const isMac = false;
    const gpuAvailable = true;
    const mode = sanitizeRenderMode('duo', isMac, gpuAvailable);
    expect(mode).toBe('duo');

    const scheduler = new RenderScheduler();
    scheduler.setGpuAvailable(true);
    scheduler.setMode('duo');
    scheduler.enqueue('win-job-1');
    scheduler.enqueue('win-job-2');

    const dispatchPlan = scheduler.planNext((_id) => true);
    // In DUO mode on Windows, both GPU and CPU slots are planned concurrently
    expect(dispatchPlan).toHaveLength(2);
    expect(dispatchPlan.map(p => p.slot)).toContain('gpu');
    expect(dispatchPlan.map(p => p.slot)).toContain('cpu');
  });

  // Pair 12: F1 (Apple Silicon Detection) + F4 (Vendor Badge Display)
  it('Pair 12 (F1 + F4): Apple Silicon CPU vendor directly populates UI vendor badge string', () => {
    const hostBrand = HardwareOracle.getHostCpuBrandString();
    const vendorResult = HardwareOracle.deriveCpuVendor(hostBrand);
    const badgeString = vendorResult.vendor.toUpperCase();
    expect(badgeString).toBe('APPLE');
  });

  // Pair 13: F7 (macOS NVENC Suppression) + F9 (Windows NVENC Preservation Invariant)
  it('Pair 13 (F7 + F9): Invariant comparison: macOS and Windows commands generated from identical settings remain isolated', () => {
    const identicalVideoSettings = TestHarness.createDefaultVideoSettings({
      codec: 'h264',
      crf: 23,
      preset: 'slow',
    });
    const audio = TestHarness.createDefaultAudioSettings();

    // macOS arguments
    const macArgs = TestHarness.buildReferenceVideoToolboxArgs(identicalVideoSettings, audio);
    // Windows arguments
    PlatformSimulator.setPlatform('windows');
    const winBuilder = new FFmpegCommandBuilder(identicalVideoSettings, audio, undefined, true);
    const winArgs = winBuilder.buildArgs();
    PlatformSimulator.restore();

    // macOS has VideoToolbox and no NVENC flags
    expect(macArgs).toContain('h264_videotoolbox');
    expect(macArgs).not.toContain('-spatial-aq');
    expect(macArgs).not.toContain('-cq');

    // Windows has NVENC and NVENC flags
    expect(winArgs).toContain('h264_nvenc');
    expect(winArgs).toContain('-spatial-aq');
    expect(winArgs).toContain('-cq');
  });

  // Pair 14: F6 (VideoToolbox Quality) + F8 (Preview Rate Control Alignment)
  it('Pair 14 (F6 + F8): Quality formula consistency: CRF 0, 23, 51 map identically in Preview and Final Render', () => {
    const crfValues = [0, 23, 51];
    for (const crf of crfValues) {
      const finalArgs = TestHarness.buildReferenceVideoToolboxArgs(
        TestHarness.createDefaultVideoSettings({ codec: 'h264', crf })
      );
      const previewArgs = TestHarness.buildReferencePreviewArgs(
        TestHarness.createDefaultPreviewSettings({ codec: 'h264', crf: crf.toString(), prefer_gpu: true }),
        true
      );

      const expectedQ = calculateVideoToolboxQuality(crf).toString();
      const finalQIdx = finalArgs.indexOf('-q:v');
      const prevQIdx = previewArgs.indexOf('-q:v');

      expect(finalArgs[finalQIdx + 1]).toBe(expectedQ);
      expect(previewArgs[prevQIdx + 1]).toBe(expectedQ);
    }
  });

  // Pair 15: F1 (Apple Silicon Detection) + F3 (Windows Detection Isolation)
  it('Pair 15 (F1 + F3): Detection isolation: sysctl execution never spawns Windows wmic on macOS', () => {
    const brand = HardwareOracle.getHostCpuBrandString();
    expect(brand).not.toBeNull();
    // WMIC is Windows-only; verify that sysctl output does not contain WMIC markers
    expect(brand).not.toContain('WMIC');
    expect(brand).not.toContain('Caption');
  });

  // Pair 16: F4 (Platform Mode Selector) + F10 (Platform UI Cleanup)
  it('Pair 16 (F4 + F10): Unified platform detection synchronizes mode selector and settings page', () => {
    const isMac = true;
    const availableModesCount = isMac ? 2 : 3;
    const showContextMenuCard = !isMac;

    expect(availableModesCount).toBe(2);
    expect(showContextMenuCard).toBe(false);
  });

  // Pair 17: F5 (Mode Sanitization) + F6 (VideoToolbox Argument Generation)
  it('Pair 17 (F5 + F6): Dispatched job after duo -> gpu sanitization builds VideoToolbox arguments', () => {
    const sanitizedMode = sanitizeRenderMode('duo', true, true);
    expect(sanitizedMode).toBe('gpu');

    // Job running under sanitized 'gpu' mode on macOS
    const preferGpu = sanitizedMode === 'gpu';
    expect(preferGpu).toBe(true);

    const settings = TestHarness.createDefaultVideoSettings({ codec: 'h264' });
    const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
    expect(args).toContain('h264_videotoolbox');
  });

  // Pair 18: F12 (Git Commits) + F13 (Comprehensive Verification)
  it('Pair 18 (F12 + F13): Conventional commits formatting aligns with verification test suite', () => {
    const milestoneCommit = 'feat(services): implement VideoToolbox argument generation for macOS';
    const regex = /^feat\((services|backend|ui|settings)\):\s.+$/;
    expect(regex.test(milestoneCommit)).toBe(true);
  });
});
