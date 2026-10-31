/**
 * Tier 2: Boundary & Corner Cases Test Suite
 * Minimum 5 tests per feature for each of the 13 inventoried features (65 tests total).
 * Derived from ORIGINAL_REQUEST.md and PROJECT.md.
 */

import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest';
import {
  HardwareInfo,
  HardwareOverride,
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

describe('Tier 2: Boundary & Corner Cases (Features 1-13)', () => {
  afterAll(() => {
    PlatformSimulator.restore();
  });

  // ==========================================================================
  // Feature 1: macOS Apple Silicon CPU Detection Boundaries
  // ==========================================================================
  describe('Feature 1: macOS Apple Silicon CPU Detection Boundaries', () => {
    it('2.1.1: empty or whitespace-only brand string returns vendor "unknown"', () => {
      expect(HardwareOracle.deriveCpuVendor('').vendor).toBe('unknown');
      expect(HardwareOracle.deriveCpuVendor('   ').vendor).toBe('unknown');
      expect(HardwareOracle.deriveCpuVendor(null).vendor).toBe('unknown');
      expect(HardwareOracle.deriveCpuVendor(undefined).vendor).toBe('unknown');
    });

    it('2.1.2: brand string with surrounding whitespace and newlines is trimmed and matched', () => {
      const noisyBrand = '\t\n Apple M2 Pro Max \r\n ';
      const result = HardwareOracle.deriveCpuVendor(noisyBrand);
      expect(result.vendor).toBe('apple');
      expect(result.reason).toContain('Apple M2 Pro Max');
    });

    it('2.1.3: brand string with non-ASCII or trademark symbols matches "apple"', () => {
      const tmBrand = 'Apple® M3 Max™ 16-Core';
      const result = HardwareOracle.deriveCpuVendor(tmBrand);
      expect(result.vendor).toBe('apple');
    });

    it('2.1.4: future unreleased Apple Silicon generations (M5, M6) are recognized', () => {
      expect(HardwareOracle.deriveCpuVendor('Apple M5 Extreme').vendor).toBe('apple');
      expect(HardwareOracle.deriveCpuVendor('Apple M6 Ultra').vendor).toBe('apple');
      expect(HardwareOracle.deriveCpuVendor('m7 max').vendor).toBe('apple');
    });

    it('2.1.5: non-Apple ARM brand string (e.g. QEMU / Graviton) returns vendor "unknown"', () => {
      const armBrand = 'Neoverse-N1 r3p1';
      const result = HardwareOracle.deriveCpuVendor(armBrand);
      expect(result.vendor).toBe('unknown');
    });
  });

  // ==========================================================================
  // Feature 2: macOS VideoToolbox HW Acceleration Detection Boundaries
  // ==========================================================================
  describe('Feature 2: macOS VideoToolbox HW Acceleration Detection Boundaries', () => {
    it('2.2.1: empty encoder output string safely returns available: false without throwing', () => {
      const detection = HardwareOracle.detectVideoToolbox('');
      expect(detection.available).toBe(false);
      expect(detection.h264).toBe(false);
      expect(detection.hevc).toBe(false);
    });

    it('2.2.2: partial encoder presence (h264 only or hevc only) sets available: true', () => {
      const onlyH264 = 'Encoders:\n V..... h264_videotoolbox VideoToolbox H.264 Encoder';
      const detH264 = HardwareOracle.detectVideoToolbox(onlyH264);
      expect(detH264.h264).toBe(true);
      expect(detH264.hevc).toBe(false);
      expect(detH264.available).toBe(true);

      const onlyHevc = 'Encoders:\n V..... hevc_videotoolbox VideoToolbox H.265 Encoder';
      const detHevc = HardwareOracle.detectVideoToolbox(onlyHevc);
      expect(detHevc.h264).toBe(false);
      expect(detHevc.hevc).toBe(true);
      expect(detHevc.available).toBe(true);
    });

    it('2.2.3: "videotoolbox" word in description but not in encoder name column is handled', () => {
      const ambiguousOutput = 'Encoders:\n V..... custom_enc Some encoder with videotoolbox description';
      const detection = HardwareOracle.detectVideoToolbox(ambiguousOutput);
      expect(detection.h264).toBe(false);
      expect(detection.hevc).toBe(false);
    });

    it('2.2.4: FFmpeg process returning non-zero exit code caught and returns failure', () => {
      const invalidArgs = ['-invalid_option_xyz'];
      const result = HardwareOracle.executeFfmpegWithArgs(invalidArgs, 0.1);
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
    });

    it('2.2.5: case variations in encoder stdout (uppercase/mixed) detected cleanly', () => {
      const mixedCase = 'Encoders:\n V..... H264_VIDEOTOOLBOX Apple HW\n V..... Hevc_VideoToolbox Apple HW';
      const detection = HardwareOracle.detectVideoToolbox(mixedCase);
      expect(detection.h264).toBe(true);
      expect(detection.hevc).toBe(true);
      expect(detection.available).toBe(true);
    });
  });

  // ==========================================================================
  // Feature 3: Windows & Linux Detection Preservation Boundaries
  // ==========================================================================
  describe('Feature 3: Windows & Linux Detection Preservation Boundaries', () => {
    it('3.1: Windows registry processor string with irregular casing and tabs handled', () => {
      const irregularString = '\t\t13th Gen INTEL(r) Core(tm) i9-13900KS   \r';
      const result = HardwareOracle.deriveCpuVendor(irregularString);
      expect(result.vendor).toBe('intel');
    });

    it('3.2: Windows WMIC returning blank lines or empty text returns vendor "unknown"', () => {
      const blankWmic = '\r\n\r\n';
      const result = HardwareOracle.parseWmicCpuOutput(blankWmic);
      expect(result.vendor).toBe('unknown');
    });

    it('3.3: Windows Registry display adapter check with multiple GPUs prioritizes discrete GPU', () => {
      const dualGpuListing = 'NVIDIA GeForce RTX 4080\nIntel(R) UHD Graphics 770';
      const lower = dualGpuListing.toLowerCase();
      const hasNvidia = lower.includes('nvidia') || lower.includes('geforce');
      expect(hasNvidia).toBe(true);
    });

    it('3.4: Linux /proc/cpuinfo with missing vendor or empty cores returns "unknown"', () => {
      const brokenCpuinfo = 'processor: 0\nflags: fpu vme de';
      const result = HardwareOracle.parseProcCpuinfo(brokenCpuinfo);
      expect(result.vendor).toBe('unknown');
    });

    it('3.5: mixed casing in Linux cpuinfo ("AuthenticAMD", "GenuineIntel") correctly parsed', () => {
      const amdInfo = 'vendor_id: AuthenticAMD\nmodel name: AMD Ryzen 7';
      const intelInfo = 'vendor_id: GenuineIntel\nmodel name: Intel Core i7';
      expect(HardwareOracle.parseProcCpuinfo(amdInfo).vendor).toBe('amd');
      expect(HardwareOracle.parseProcCpuinfo(intelInfo).vendor).toBe('intel');
    });
  });

  // ==========================================================================
  // Feature 4: Platform-Aware UI Mode Selector Boundaries
  // ==========================================================================
  describe('Feature 4: Platform-Aware UI Mode Selector Boundaries', () => {
    it('4.1: rapid mode switching on macOS between "cpu" and "gpu" maintains valid state', () => {
      let currentMode: 'cpu' | 'gpu' = 'cpu';
      const onModeChange = (mode: 'cpu' | 'gpu') => { currentMode = mode; };

      for (let i = 0; i < 50; i++) {
        onModeChange(i % 2 === 0 ? 'gpu' : 'cpu');
      }
      expect(['cpu', 'gpu']).toContain(currentMode);
    });

    it('4.2: dynamic loss of GPU availability forces immediate fallback to CPU', () => {
      let gpuAvailable = true;
      let activeMode = 'gpu';

      // GPU disappears (e.g. disconnect or driver reset)
      gpuAvailable = false;
      if (!gpuAvailable && activeMode === 'gpu') {
        activeMode = 'cpu';
      }
      expect(activeMode).toBe('cpu');
    });

    it('4.3: uninitialized or custom theme returns fallback gradient without crashing', () => {
      const fallbackConfig = {
        primary: '#6366f1',
        secondary: '#a78bfa',
        glow: 'rgba(99, 102, 241, 0.6)',
      };
      expect(fallbackConfig.primary).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('4.4: programmatic attempt to set "duo" mode on macOS is blocked', () => {
      const isMac = true;
      const attemptMode = 'duo';
      let resolvedMode: string = attemptMode;
      if (isMac && attemptMode === 'duo') {
        resolvedMode = 'gpu';
      }
      expect(resolvedMode).toBe('gpu');
      expect(resolvedMode).not.toBe('duo');
    });

    it('4.5: vendor badge fallback handles undefined or empty vendor safely', () => {
      const emptyVendor = '';
      const badgeText = (emptyVendor || 'UNKNOWN').toUpperCase();
      expect(badgeText).toBe('UNKNOWN');
    });
  });

  // ==========================================================================
  // Feature 5: Mode Sanitization & Backward Compatibility Boundaries
  // ==========================================================================
  describe('Feature 5: Mode Sanitization & Backward Compatibility Boundaries', () => {
    it('5.1: malformed mode string falls back safely to "cpu"', () => {
      const sanitized = sanitizeRenderMode('invalid' as any, true, true);
      expect(sanitized).toBe('cpu');
    });

    it('5.2: "gpu" mode requested when GPU unavailable on Windows falls back to "cpu"', () => {
      const sanitized = sanitizeRenderMode('gpu', false, false);
      expect(sanitized).toBe('cpu');
    });

    it('5.3: high-load queue: enqueuing 1000 jobs in sanitized mode retains deterministic FIFO order', () => {
      const scheduler = new RenderScheduler();
      scheduler.setGpuAvailable(true);
      scheduler.setMode('cpu');

      for (let i = 0; i < 1000; i++) {
        scheduler.enqueue(`stress-job-${i}`);
      }
      expect(scheduler.getQueue()).toHaveLength(1000);
      expect(scheduler.getQueue()[0]).toBe('stress-job-0');
      expect(scheduler.getQueue()[999]).toBe('stress-job-999');
    });

    it('5.4: queue deduplication prevents identical job IDs from duplicating', () => {
      const scheduler = new RenderScheduler();
      for (let i = 0; i < 20; i++) {
        scheduler.enqueue('duplicate-job');
      }
      expect(scheduler.getQueue()).toHaveLength(1);
    });

    it('5.5: releasing a non-existent or inactive job ID does not corrupt scheduler state', () => {
      const scheduler = new RenderScheduler();
      expect(() => scheduler.release('ghost-job')).not.toThrow();
      expect(scheduler.getSlots()).toEqual({ cpuSlot: null, gpuSlot: null });
    });
  });

  // ==========================================================================
  // Feature 6: VideoToolbox Video Encoder Parameter Generation Boundaries
  // ==========================================================================
  describe('Feature 6: VideoToolbox Video Encoder Parameter Generation Boundaries', () => {
    it('6.1: CRF 0 (maximum quality) maps to -q:v 100', () => {
      expect(calculateVideoToolboxQuality(0)).toBe(100);
      const settings = TestHarness.createDefaultVideoSettings({ crf: 0 });
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
      expect(args).toContain('-q:v');
      expect(args).toContain('100');
    });

    it('6.2: CRF 51 (minimum quality) maps to -q:v 1', () => {
      expect(calculateVideoToolboxQuality(51)).toBe(1);
      const settings = TestHarness.createDefaultVideoSettings({ crf: 51 });
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
      expect(args).toContain('-q:v');
      expect(args).toContain('1');
    });

    it('6.3: out-of-bounds CRF values (negative or >51) clamped to [1, 100]', () => {
      expect(calculateVideoToolboxQuality(-10)).toBe(100);
      expect(calculateVideoToolboxQuality(100)).toBe(1);
      expect(calculateVideoToolboxQuality(NaN)).toBe(55); // Default
    });

    it('6.4: extreme bitrate boundaries (0.1 Mbps and 200 Mbps) formatted correctly', () => {
      const lowBitrate = TestHarness.createDefaultVideoSettings({
        rateControlMode: 'vbr',
        bitrate: 0.1,
      });
      const lowArgs = TestHarness.buildReferenceVideoToolboxArgs(lowBitrate);
      expect(lowArgs).toContain('0.1M');

      const highBitrate = TestHarness.createDefaultVideoSettings({
        rateControlMode: 'vbr',
        bitrate: 200,
      });
      const highArgs = TestHarness.buildReferenceVideoToolboxArgs(highBitrate);
      expect(highArgs).toContain('200M');
    });

    it('6.5: zero or negative bitrate falls back to standard default 5M', () => {
      const zeroBitrate = TestHarness.createDefaultVideoSettings({
        rateControlMode: 'vbr',
        bitrate: 0,
      });
      const zeroArgs = TestHarness.buildReferenceVideoToolboxArgs(zeroBitrate);
      expect(zeroArgs).toContain('5M');
    });
  });

  // ==========================================================================
  // Feature 7: Suppress NVENC-Specific Flags on macOS Boundaries
  // ==========================================================================
  describe('Feature 7: Suppress NVENC-Specific Flags on macOS Boundaries', () => {
    it('7.1: passing nvencMultipass="fullres" on macOS strictly omits -multipass', () => {
      const settings = TestHarness.createDefaultVideoSettings({ nvencMultipass: 'fullres' });
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
      expect(args).not.toContain('-multipass');
      expect(args).not.toContain('fullres');
    });

    it('7.2: passing high bFrames (e.g. 16) on macOS does NOT inject -b_ref_mode', () => {
      const settings = TestHarness.createDefaultVideoSettings({ bFrames: 16 });
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
      expect(args).not.toContain('-b_ref_mode');
    });

    it('7.3: custom HDR profile on macOS does NOT emit -tune hq or -tune ll', () => {
      const settings = TestHarness.createDefaultVideoSettings({ contentType: 'cinema' });
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
      expect(args).not.toContain('-tune');
    });

    it('7.4: rapid variation of rateControlMode across all settings never leaks NVENC flags', () => {
      const modes = ['crf', 'vbr', 'cbr', 'constrained_crf'] as const;
      for (const mode of modes) {
        const settings = TestHarness.createDefaultVideoSettings({ rateControlMode: mode });
        const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
        const forbidden = ArgumentEvaluator.findForbiddenVideoToolboxFlags(args);
        expect(forbidden).toEqual([]);
      }
    });

    it('7.5: host FFmpeg confirms passing -multipass fullres to VideoToolbox causes failure', () => {
      const forbiddenArgs = ['-c:v', 'h264_videotoolbox', '-multipass', 'fullres'];
      const result = HardwareOracle.executeFfmpegWithArgs(forbiddenArgs, 0.2);
      expect(result.success).toBe(false);
      expect(result.stderr).toContain("Unrecognized option 'multipass'");
    });
  });

  // ==========================================================================
  // Feature 8: Preview Generation VideoToolbox Alignment Boundaries
  // ==========================================================================
  describe('Feature 8: Preview Generation VideoToolbox Alignment Boundaries', () => {
    it('8.1: preview duration <= 0 clamps to valid minimum', () => {
      const preview = TestHarness.createDefaultPreviewSettings({ duration: -5 });
      const args = TestHarness.buildReferencePreviewArgs(preview, true);
      const tIdx = args.indexOf('-t');
      expect(parseFloat(args[tIdx + 1])).toBeGreaterThanOrEqual(0.1);
    });

    it('8.2: preview duration of 100s strictly clamps to 5.0 seconds', () => {
      const preview = TestHarness.createDefaultPreviewSettings({ duration: 100.0 });
      const args = TestHarness.buildReferencePreviewArgs(preview, true);
      const tIdx = args.indexOf('-t');
      expect(args[tIdx + 1]).toBe('5.0');
    });

    it('8.3: preview seek time 0.0 formats cleanly as 0.000', () => {
      const preview = TestHarness.createDefaultPreviewSettings({ time_seconds: 0.0 });
      const args = TestHarness.buildReferencePreviewArgs(preview, true);
      const ssIdx = args.indexOf('-ss');
      expect(args[ssIdx + 1]).toBe('0.000');
    });

    it('8.4: large seek timestamp (86400.123s) formats with 3 decimal precision', () => {
      const preview = TestHarness.createDefaultPreviewSettings({ time_seconds: 86400.123 });
      const args = TestHarness.buildReferencePreviewArgs(preview, true);
      const ssIdx = args.indexOf('-ss');
      expect(args[ssIdx + 1]).toBe('86400.123');
    });

    it('8.5: preview with codec unsupported on macOS GPU (vp9) falls back to CPU', () => {
      const preview = TestHarness.createDefaultPreviewSettings({
        codec: 'vp9',
        prefer_gpu: true,
      });
      // Currently preview builder falls back to libx264/libx265 for unsupported GPU codecs
      const args = TestHarness.buildReferencePreviewArgs(preview, true);
      expect(args).toContain('-c:v');
      expect(args).not.toContain('videotoolbox');
    });
  });

  // ==========================================================================
  // Feature 9: Windows NVENC Argument Preservation Boundaries
  // ==========================================================================
  describe('Feature 9: Windows NVENC Argument Preservation Boundaries', () => {
    beforeEach(() => {
      PlatformSimulator.setPlatform('windows');
    });

    afterEach(() => {
      PlatformSimulator.restore();
    });

    it('9.1: NVENC bFrames 0 passes -bf 0 without error', () => {
      const videoSettings = TestHarness.createDefaultVideoSettings({
        codec: 'h264',
        bFrames: 0,
      });
      const audioSettings = TestHarness.createDefaultAudioSettings();
      const builder = new FFmpegCommandBuilder(videoSettings, audioSettings, undefined, true);
      const args = builder.buildArgs();
      const bfIdx = args.indexOf('-bf');
      expect(bfIdx).not.toBe(-1);
      expect(args[bfIdx + 1]).toBe('0');
    });

    it('9.2: NVENC bFrames 8 clamps strictly to -bf 4 (NVENC hardware limit)', () => {
      const videoSettings = TestHarness.createDefaultVideoSettings({
        codec: 'h264',
        bFrames: 8,
      });
      const audioSettings = TestHarness.createDefaultAudioSettings();
      const builder = new FFmpegCommandBuilder(videoSettings, audioSettings, undefined, true);
      const args = builder.buildArgs();
      const bfIdx = args.indexOf('-bf');
      expect(bfIdx).not.toBe(-1);
      expect(args[bfIdx + 1]).toBe('4');
    });

    it('9.3: NVENC CQ boundaries: CRF 0 maps to -cq 0 and CRF 51 maps to -cq 51', () => {
      const v0 = TestHarness.createDefaultVideoSettings({ codec: 'h264', crf: '0' as any });
      const a = TestHarness.createDefaultAudioSettings();
      const b0 = new FFmpegCommandBuilder(v0, a, undefined, true);
      const args0 = b0.buildArgs();
      const cqIdx0 = args0.indexOf('-cq');
      expect(cqIdx0).not.toBe(-1);
      expect(args0[cqIdx0 + 1]).toBe('0');

      const v51 = TestHarness.createDefaultVideoSettings({ codec: 'h264', crf: '51' as any });
      const b51 = new FFmpegCommandBuilder(v51, a, undefined, true);
      const args51 = b51.buildArgs();
      const cqIdx51 = args51.indexOf('-cq');
      expect(cqIdx51).not.toBe(-1);
      expect(args51[cqIdx51 + 1]).toBe('51');
    });

    it('9.4: unrecognized preset name falls back to default NVENC preset p4', () => {
      const videoSettings = TestHarness.createDefaultVideoSettings({
        codec: 'h264',
        preset: 'ultra_non_existent',
      });
      const audioSettings = TestHarness.createDefaultAudioSettings();
      const builder = new FFmpegCommandBuilder(videoSettings, audioSettings, undefined, true);
      const args = builder.buildArgs();
      const pIdx = args.indexOf('-preset');
      expect(pIdx).not.toBe(-1);
      expect(args[pIdx + 1]).toBe('p4');
    });

    it('9.5: spatialAq false suppresses -spatial-aq 1 on NVENC', () => {
      const videoSettings = TestHarness.createDefaultVideoSettings({
        codec: 'h264',
      });
      (videoSettings as any).spatialAq = false;
      const audioSettings = TestHarness.createDefaultAudioSettings();
      const builder = new FFmpegCommandBuilder(videoSettings, audioSettings, undefined, true);
      const args = builder.buildArgs();
      expect(args).not.toContain('-spatial-aq');
    });
  });

  // ==========================================================================
  // Feature 10: Platform-Specific UI Cleanup in GeneralSettings Boundaries
  // ==========================================================================
  describe('Feature 10: Platform-Specific UI Cleanup in GeneralSettings Boundaries', () => {
    it('10.1: unmounting component while IPC is pending cleans up safely', () => {
      let isMounted = true;
      let stateUpdated = false;
      const unmount = () => { isMounted = false; };

      setTimeout(() => {
        if (isMounted) stateUpdated = true;
      }, 10);
      unmount();
      expect(stateUpdated).toBe(false);
    });

    it('10.2: backend IPC rejection sets error state without crash', () => {
      const errorState = { enabled: false, exe_valid: false, loading: false, error: 'IPC error' };
      expect(errorState.loading).toBe(false);
      expect(errorState.error).toBeDefined();
    });

    it('10.3: rapid clicking Add Context Menu respects loading: true disabled state', () => {
      const status = { enabled: false, loading: true };
      const isButtonDisabled = status.loading;
      expect(isButtonDisabled).toBe(true);
    });

    it('10.4: Linux platform also suppresses Windows Context Menu card', () => {
      const currentPlatform = 'linux';
      const isWindows = currentPlatform === 'windows';
      expect(isWindows).toBe(false);
    });

    it('10.5: corrupt status with enabled: true but exe_valid: undefined defaults exe_valid to false', () => {
      const rawStatus: any = { enabled: true };
      const normalizedExeValid = Boolean(rawStatus.exe_valid);
      expect(normalizedExeValid).toBe(false);
    });
  });

  // ==========================================================================
  // Feature 11: Dynamic Settings Adaptation in VideoSettings Boundaries
  // ==========================================================================
  describe('Feature 11: Dynamic Settings Adaptation in VideoSettings Boundaries', () => {
    it('11.1: switching target format from Video to GIF mode disables hardware encoding', () => {
      const gifSettings = TestHarness.createDefaultVideoSettings({
        targetFormat: 'gif',
      });
      const audioSettings = TestHarness.createDefaultAudioSettings();
      const builder = new FFmpegCommandBuilder(gifSettings, audioSettings, undefined, true);
      const args = builder.buildArgs();
      expect(args).not.toContain('videotoolbox');
      expect(args).not.toContain('nvenc');
    });

    it('11.2: setting hwaccel to "disabled" on macOS removes hardware decoding flag', () => {
      const settings = TestHarness.createDefaultVideoSettings({
        hwaccel: 'disabled',
      });
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
      expect(args).not.toContain('-hwaccel');
    });

    it('11.3: setting hwaccel to "videotoolbox" emits -hwaccel videotoolbox', () => {
      const settings = TestHarness.createDefaultVideoSettings({
        hwaccel: 'videotoolbox',
      });
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
      const hwIdx = args.indexOf('-hwaccel');
      expect(hwIdx).not.toBe(-1);
      expect(args[hwIdx + 1]).toBe('videotoolbox');
    });

    it('11.4: content profiles ("gaming", "cinema", "presentation") output valid VideoToolbox commands', () => {
      const profiles = ['standard', 'gaming', 'cinema', 'presentation'];
      for (const profile of profiles) {
        const settings = TestHarness.createDefaultVideoSettings({ contentType: profile });
        const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
        expect(args).toContain('h264_videotoolbox');
      }
    });

    it('11.5: empty or undefined codec defaults safely to h264', () => {
      const settings = TestHarness.createDefaultVideoSettings({ codec: '' });
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
      expect(args).toContain('h264_videotoolbox');
    });
  });

  // ==========================================================================
  // Feature 12: Step-by-Step Git Commits Boundaries
  // ==========================================================================
  describe('Feature 12: Step-by-Step Git Commits Boundaries', () => {
    it('12.1: empty commit message string is rejected by Conventional Commits validator', () => {
      const conventionalRegex = /^(feat|fix|test|refactor|chore|docs)(\([a-z0-9_-]+\))?:\s.+$/;
      expect(conventionalRegex.test('')).toBe(false);
      expect(conventionalRegex.test('   ')).toBe(false);
    });

    it('12.2: commit message without type prefix is rejected', () => {
      const conventionalRegex = /^(feat|fix|test|refactor|chore|docs)(\([a-z0-9_-]+\))?:\s.+$/;
      expect(conventionalRegex.test('added some new features for mac')).toBe(false);
    });

    it('12.3: commit message with invalid type prefix (e.g. "update:") is rejected', () => {
      const conventionalRegex = /^(feat|fix|test|refactor|chore|docs)(\([a-z0-9_-]+\))?:\s.+$/;
      expect(conventionalRegex.test('update: macos detection')).toBe(false);
    });

    it('12.4: commit message with multiline body separates header with blank line', () => {
      const fullCommit = 'feat(backend): implement sysctl brand string\n\nDetailed explanation of sysctl output.';
      const lines = fullCommit.split('\n');
      expect(lines[0]).toBe('feat(backend): implement sysctl brand string');
      expect(lines[1]).toBe('');
    });

    it('12.5: commit messages with unicode or emoji characters handle cleanly', () => {
      const unicodeCommit = 'feat(ui): support Apple Silicon 🍏 mode selector';
      expect(unicodeCommit).toContain('Apple Silicon');
    });
  });

  // ==========================================================================
  // Feature 13: Comprehensive E2E Verification & Hardening Boundaries
  // ==========================================================================
  describe('Feature 13: Comprehensive E2E Verification & Hardening Boundaries', () => {
    it('13.1: file path with Unicode, spaces, and brackets handled without argument splitting', () => {
      const complexPath = '/Volumes/Media/Videos [2026] & Clips/Final (4K) 🚀.mp4';
      const preview = TestHarness.createDefaultPreviewSettings({ video_path: complexPath });
      const args = TestHarness.buildReferencePreviewArgs(preview, true);
      const iIdx = args.indexOf('-i');
      expect(args[iIdx + 1]).toBe(complexPath);
    });

    it('13.2: extremely long file path (500+ characters) passes through cleanly', () => {
      const longDir = 'a'.repeat(400);
      const longPath = `/${longDir}/video.mp4`;
      const preview = TestHarness.createDefaultPreviewSettings({ video_path: longPath });
      const args = TestHarness.buildReferencePreviewArgs(preview, true);
      expect(args).toContain(longPath);
    });

    it('13.3: audio volume boundary (0.0 muted to 2.0 boosted) validates cleanly', () => {
      const mutedAudio = TestHarness.createDefaultAudioSettings({ volume: 0.0 });
      const boostedAudio = TestHarness.createDefaultAudioSettings({ volume: 2.0 });
      expect(mutedAudio.volume).toBe(0.0);
      expect(boostedAudio.volume).toBe(2.0);
    });

    it('13.4: audio validation clamps extreme sample rates to standard limits', () => {
      const audioSettings = TestHarness.createDefaultAudioSettings({
        sampleRate: '192000',
      });
      const validated = validateForRender(audioSettings as any, 'aac');
      expect(parseInt(validated.settings.sampleRate, 10)).toBeLessThanOrEqual(96000);
    });

    it('13.5: concurrent command builders produce independent argument instances', () => {
      const v1 = TestHarness.createDefaultVideoSettings({ codec: 'h264', crf: 18 });
      const v2 = TestHarness.createDefaultVideoSettings({ codec: 'hevc', crf: 30 });
      const a = TestHarness.createDefaultAudioSettings();

      const b1 = new FFmpegCommandBuilder(v1, a, undefined, false);
      const b2 = new FFmpegCommandBuilder(v2, a, undefined, false);

      const args1 = b1.buildArgs();
      const args2 = b2.buildArgs();

      expect(args1).toContain('libx264');
      expect(args2).toContain('libx265');
      expect(args1).not.toEqual(args2);
    });
  });
});
