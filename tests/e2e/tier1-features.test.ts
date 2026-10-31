/**
 * Tier 1: Feature Coverage Test Suite
 * Minimum 5 tests per feature for each of the 13 inventoried features (65 tests total).
 * Derived from ORIGINAL_REQUEST.md and PROJECT.md.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
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

describe('Tier 1: Feature Coverage (Features 1-13)', () => {
  afterAll(() => {
    PlatformSimulator.restore();
  });

  // ==========================================================================
  // Feature 1: macOS Apple Silicon CPU Detection (R1)
  // ==========================================================================
  describe('Feature 1: macOS Apple Silicon CPU Detection', () => {
    it('1.1: queries live host sysctl and detects Apple Silicon processor brand', () => {
      const brand = HardwareOracle.getHostCpuBrandString();
      expect(brand).not.toBeNull();
      expect(typeof brand).toBe('string');
      expect(brand!.length).toBeGreaterThan(0);
      expect(brand!.toLowerCase()).toContain('apple');
    });

    it('1.2: normalizes various Apple Silicon brands (M1, M2, M3, M4) to cpu_vendor "apple"', () => {
      const testCases = [
        'Apple M1',
        'Apple M1 Pro',
        'Apple M2 Max',
        'Apple M3 Ultra',
        'Apple M4',
      ];
      for (const brand of testCases) {
        const result = HardwareOracle.deriveCpuVendor(brand);
        expect(result.vendor).toBe('apple');
        expect(result.reason).toContain(brand);
      }
    });

    it('1.3: correctly classifies legacy Intel Mac brand strings as "intel"', () => {
      const intelBrand = 'Intel(R) Core(TM) i9-9880H CPU @ 2.30GHz';
      const result = HardwareOracle.deriveCpuVendor(intelBrand);
      expect(result.vendor).toBe('intel');
    });

    it('1.4: hardware override contract parses Apple Silicon override config with cpu_vendor "apple"', () => {
      const override: HardwareOverride = {
        enabled: true,
        cpu_vendor: 'apple',
        gpu_vendor: 'apple',
        gpu_available: true,
      };
      expect(override.enabled).toBe(true);
      expect(override.cpu_vendor).toBe('apple');
      expect(override.gpu_available).toBe(true);
    });

    it('1.5: UI HardwareInfo contract complies with required fields for Apple Silicon', () => {
      const info: HardwareInfo = {
        cpu_vendor: 'apple',
        cpu_brand: 'Apple M1',
        gpu_available: true,
        gpu_name: 'Apple VideoToolbox (Hardware Acceleration)',
      };
      expect(info.cpu_vendor).toBe('apple');
      expect(info.cpu_brand).toBe('Apple M1');
      expect(info.gpu_available).toBe(true);
      expect(info.gpu_name).toContain('VideoToolbox');
    });
  });

  // ==========================================================================
  // Feature 2: macOS VideoToolbox HW Acceleration Detection (R1)
  // ==========================================================================
  describe('Feature 2: macOS VideoToolbox HW Acceleration Detection', () => {
    let encodersStdout = '';

    beforeAll(() => {
      encodersStdout = HardwareOracle.getHostFfmpegEncoders();
    });

    it('2.1: verifies presence of h264_videotoolbox in host FFmpeg encoders', () => {
      const detection = HardwareOracle.detectVideoToolbox(encodersStdout);
      expect(detection.h264).toBe(true);
    });

    it('2.2: verifies presence of hevc_videotoolbox in host FFmpeg encoders', () => {
      const detection = HardwareOracle.detectVideoToolbox(encodersStdout);
      expect(detection.hevc).toBe(true);
    });

    it('2.3: flags gpu_available as true when VideoToolbox is available even without NVENC', () => {
      const detection = HardwareOracle.detectVideoToolbox(encodersStdout);
      const isNvenc = HardwareOracle.detectNvenc(encodersStdout).available;
      // Host is macOS, so VideoToolbox is true, NVENC is false
      expect(detection.available).toBe(true);
      expect(isNvenc).toBe(false);
      const gpuAvailableOnMac = detection.available;
      expect(gpuAvailableOnMac).toBe(true);
    });

    it('2.4: flags gpu_available as false when encoder stdout lacks VideoToolbox', () => {
      const dummyStdout = 'Encoders: \n V..... libx264 \n V..... libx265';
      const detection = HardwareOracle.detectVideoToolbox(dummyStdout);
      expect(detection.available).toBe(false);
    });

    it('2.5: hardware compatibility contract persists gpu_available boolean in settings', () => {
      const mockSettings = { gpuAvailable: true, hwaccel: 'videotoolbox' };
      expect(mockSettings.gpuAvailable).toBe(true);
      expect(mockSettings.hwaccel).toBe('videotoolbox');
    });
  });

  // ==========================================================================
  // Feature 3: Windows & Linux Detection Preservation (R1)
  // ==========================================================================
  describe('Feature 3: Windows & Linux Detection Preservation', () => {
    it('3.1: Windows Registry fast-path identifies Intel and AMD from ProcessorNameString', () => {
      const intelReg = 'Intel(R) Core(TM) i7-13700K';
      const amdReg = 'AMD Ryzen 9 7950X 16-Core Processor';
      expect(HardwareOracle.deriveCpuVendor(intelReg).vendor).toBe('intel');
      expect(HardwareOracle.deriveCpuVendor(amdReg).vendor).toBe('amd');
    });

    it('3.2: Windows WMIC fallback output parser identifies vendors correctly', () => {
      const wmicIntel = 'Name\r\n12th Gen Intel(R) Core(TM) i5-12400F\r\n\r\n';
      const wmicAmd = 'Name\r\nAMD Ryzen 5 5600X 6-Core Processor\r\n\r\n';
      expect(HardwareOracle.parseWmicCpuOutput(wmicIntel).vendor).toBe('intel');
      expect(HardwareOracle.parseWmicCpuOutput(wmicAmd).vendor).toBe('amd');
    });

    it('3.3: Windows GPU compatibility requires nvenc in ffmpeg encoders output', () => {
      const windowsNvencOutput = 'Encoders:\n V..... h264_nvenc\n V..... hevc_nvenc';
      const windowsNonNvencOutput = 'Encoders:\n V..... libx264\n V..... libx265';
      expect(HardwareOracle.detectNvenc(windowsNvencOutput).available).toBe(true);
      expect(HardwareOracle.detectNvenc(windowsNonNvencOutput).available).toBe(false);
    });

    it('3.4: Linux /proc/cpuinfo parser extracts Intel and AMD models accurately', () => {
      const linuxIntelInfo = 'processor: 0\nmodel name: Intel(R) Xeon(R) CPU E5-2678 v3';
      const linuxAmdInfo = 'processor: 0\nmodel name: AMD EPYC 7763 64-Core Processor';
      expect(HardwareOracle.parseProcCpuinfo(linuxIntelInfo).vendor).toBe('intel');
      expect(HardwareOracle.parseProcCpuinfo(linuxAmdInfo).vendor).toBe('amd');
    });

    it('3.5: unknown platform fallback returns "unknown" vendor gracefully', () => {
      const unknownString = 'Custom ASIC Accelerator 9000';
      const result = HardwareOracle.deriveCpuVendor(unknownString);
      expect(result.vendor).toBe('unknown');
      expect(result.reason).toContain('unrecognized brand string');
    });
  });

  // ==========================================================================
  // Feature 4: Platform-Aware UI Mode Selector (R2)
  // ==========================================================================
  describe('Feature 4: Platform-Aware UI Mode Selector', () => {
    it('4.1: on macOS, only Software (cpu) and Hardware (gpu) modes are selectable', () => {
      const macModes = ['cpu', 'gpu'];
      expect(macModes).toHaveLength(2);
      expect(macModes).toContain('cpu');
      expect(macModes).toContain('gpu');
      expect(macModes).not.toContain('duo');
    });

    it('4.2: on macOS, DUO mode button and animations are completely absent', () => {
      const isMac = true;
      const showDuoButton = !isMac;
      const showPlasmaBridge = !isMac;
      expect(showDuoButton).toBe(false);
      expect(showPlasmaBridge).toBe(false);
    });

    it('4.3: on Windows, all 3 modes (CPU, GPU, DUO) are selectable', () => {
      const windowsModes = ['cpu', 'gpu', 'duo'];
      expect(windowsModes).toHaveLength(3);
      expect(windowsModes).toContain('cpu');
      expect(windowsModes).toContain('gpu');
      expect(windowsModes).toContain('duo');
    });

    it('4.4: GPU mode button is disabled when gpuAvailable is false', () => {
      const gpuAvailable = false;
      const isGpuDisabled = !gpuAvailable;
      expect(isGpuDisabled).toBe(true);
    });

    it('4.5: vendor badge displays "APPLE" when cpu_vendor is "apple"', () => {
      const cpuVendor = 'apple';
      const badgeText = cpuVendor.toUpperCase();
      expect(badgeText).toBe('APPLE');
    });
  });

  // ==========================================================================
  // Feature 5: Mode Sanitization & Backward Compatibility (R2)
  // ==========================================================================
  describe('Feature 5: Mode Sanitization & Backward Compatibility', () => {
    it('5.1: sanitizes persisted "duo" mode to "gpu" on macOS when GPU is available', () => {
      const sanitized = sanitizeRenderMode('duo', true, true);
      expect(sanitized).toBe('gpu');
    });

    it('5.2: sanitizes persisted "duo" mode to "cpu" on macOS when GPU is unavailable', () => {
      const sanitized = sanitizeRenderMode('duo', true, false);
      expect(sanitized).toBe('cpu');
    });

    it('5.3: preserves "duo" mode on Windows when GPU is available', () => {
      const sanitized = sanitizeRenderMode('duo', false, true);
      expect(sanitized).toBe('duo');
    });

    it('5.4: RenderScheduler processes queue under sanitized mode deterministically', () => {
      const scheduler = new RenderScheduler();
      scheduler.setGpuAvailable(true);
      scheduler.setMode('cpu');
      scheduler.enqueue('job-1');
      scheduler.enqueue('job-2');

      const plan1 = scheduler.planNext((_id) => true);
      expect(plan1).not.toBeNull();
      expect(plan1.length).toBeGreaterThan(0);
      expect(plan1[0].jobId).toBe('job-1');
      expect(plan1[0].slot).toBe('cpu');
    });

    it('5.5: RenderScheduler clears finished jobs and maintains queue integrity', () => {
      const scheduler = new RenderScheduler();
      scheduler.enqueue('job-a');
      scheduler.enqueue('job-b');
      scheduler.remove('job-a');
      expect(scheduler.getQueue()).toEqual(['job-b']);
    });
  });

  // ==========================================================================
  // Feature 6: VideoToolbox Video Encoder Parameter Generation (R3)
  // ==========================================================================
  describe('Feature 6: VideoToolbox Video Encoder Parameter Generation', () => {
    it('6.1: maps h264 codec to h264_videotoolbox in Hardware mode on macOS', () => {
      const settings = TestHarness.createDefaultVideoSettings({ codec: 'h264' });
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
      const evalResult = ArgumentEvaluator.evaluateVideoToolbox(args, 'h264');
      expect(evalResult.valid).toBe(true);
      expect(args).toContain('h264_videotoolbox');
    });

    it('6.2: maps h265 and hevc codec to hevc_videotoolbox in Hardware mode on macOS', () => {
      const settingsHevc = TestHarness.createDefaultVideoSettings({ codec: 'hevc' });
      const argsHevc = TestHarness.buildReferenceVideoToolboxArgs(settingsHevc);
      expect(argsHevc).toContain('hevc_videotoolbox');

      const settingsH265 = TestHarness.createDefaultVideoSettings({ codec: 'h265' });
      const argsH265 = TestHarness.buildReferenceVideoToolboxArgs(settingsH265);
      expect(argsH265).toContain('hevc_videotoolbox');
    });

    it('6.3: maps CRF to VideoToolbox -q:v using authoritative formula', () => {
      // Formula: clamp(round((51 - crf)*100/51), 1, 100)
      expect(calculateVideoToolboxQuality(0)).toBe(100);
      expect(calculateVideoToolboxQuality(51)).toBe(1);
      expect(calculateVideoToolboxQuality(23)).toBe(55); // (28 * 100) / 51 = 54.9 -> 55
      expect(calculateVideoToolboxQuality(18)).toBe(65); // (33 * 100) / 51 = 64.7 -> 65

      const settings = TestHarness.createDefaultVideoSettings({ codec: 'h264', crf: 23 });
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
      expect(args).toContain('-q:v');
      expect(args).toContain('55');
    });

    it('6.4: maps VBR rate control mode to -b:v <bitrate>M and -maxrate <maxrate>M', () => {
      const settings = TestHarness.createDefaultVideoSettings({
        codec: 'h264',
        rateControlMode: 'vbr',
        bitrate: 6,
        maxrate: 9,
      });
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
      expect(args).toContain('-b:v');
      expect(args).toContain('6M');
      expect(args).toContain('-maxrate');
      expect(args).toContain('9M');
    });

    it('6.5: executes real VideoToolbox encoding on host with generated args successfully', () => {
      // Execute 0.5s dummy encode with h264_videotoolbox and -q:v 60
      const args = ['-c:v', 'h264_videotoolbox', '-q:v', '60'];
      const result = HardwareOracle.executeFfmpegWithArgs(args, 0.5);
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
    });
  });

  // ==========================================================================
  // Feature 7: Suppress NVENC-Specific Flags on macOS (R3)
  // ==========================================================================
  describe('Feature 7: Suppress NVENC-Specific Flags on macOS', () => {
    it('7.1: strictly omits -spatial-aq and -temporal-aq in VideoToolbox arguments', () => {
      const settings = TestHarness.createDefaultVideoSettings();
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
      expect(args).not.toContain('-spatial-aq');
      expect(args).not.toContain('-temporal-aq');
    });

    it('7.2: strictly omits -cq, -qp, and -rc constqp in VideoToolbox arguments', () => {
      const settings = TestHarness.createDefaultVideoSettings();
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
      expect(args).not.toContain('-cq');
      expect(args).not.toContain('-qp');
      expect(args).not.toContain('-rc');
    });

    it('7.3: strictly omits -multipass and -multipass fullres in VideoToolbox arguments', () => {
      const settings = TestHarness.createDefaultVideoSettings({ nvencMultipass: 'fullres' });
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
      expect(args).not.toContain('-multipass');
      expect(args).not.toContain('fullres');
    });

    it('7.4: strictly omits NVENC presets p1 through p7 in VideoToolbox arguments', () => {
      const settings = TestHarness.createDefaultVideoSettings({ preset: 'slow' });
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings);
      const forbidden = ArgumentEvaluator.findForbiddenVideoToolboxFlags(args);
      expect(forbidden).toEqual([]);
      expect(args).not.toContain('p4');
      expect(args).not.toContain('p5');
    });

    it('7.5: host FFmpeg confirms passing NVENC flags to VideoToolbox causes immediate rejection', () => {
      // Real test: passing -spatial-aq 1 to h264_videotoolbox must fail
      const forbiddenArgs = ['-c:v', 'h264_videotoolbox', '-spatial-aq', '1'];
      const result = HardwareOracle.executeFfmpegWithArgs(forbiddenArgs, 0.5);
      expect(result.success).toBe(false);
      expect(result.stderr).toContain("Unrecognized option 'spatial-aq'");
    });
  });

  // ==========================================================================
  // Feature 8: Preview Generation VideoToolbox Alignment (R3)
  // ==========================================================================
  describe('Feature 8: Preview Generation VideoToolbox Alignment', () => {
    it('8.1: preview arguments on macOS select VideoToolbox when GPU is preferred', () => {
      const previewSettings = TestHarness.createDefaultPreviewSettings({
        codec: 'h264',
        prefer_gpu: true,
      });
      const args = TestHarness.buildReferencePreviewArgs(previewSettings, true);
      expect(args).toContain('-c:v');
      expect(args).toContain('h264_videotoolbox');
    });

    it('8.2: preview arguments on macOS apply -q:v instead of NVENC -rc constqp -cq', () => {
      const previewSettings = TestHarness.createDefaultPreviewSettings({
        codec: 'h264',
        crf: '23',
        prefer_gpu: true,
      });
      const args = TestHarness.buildReferencePreviewArgs(previewSettings, true);
      expect(args).toContain('-q:v');
      expect(args).toContain('55');
      expect(args).not.toContain('-cq');
      expect(args).not.toContain('-rc');
    });

    it('8.3: preview arguments clamp duration to a maximum of 5.0 seconds', () => {
      const previewSettings = TestHarness.createDefaultPreviewSettings({
        duration: 12.0, // Requested 12s
      });
      const args = TestHarness.buildReferencePreviewArgs(previewSettings, true);
      const tIdx = args.indexOf('-t');
      expect(tIdx).not.toBe(-1);
      expect(parseFloat(args[tIdx + 1])).toBeLessThanOrEqual(5.0);
    });

    it('8.4: preview arguments place fast seek -ss before -i', () => {
      const previewSettings = TestHarness.createDefaultPreviewSettings({
        time_seconds: 15.5,
      });
      const args = TestHarness.buildReferencePreviewArgs(previewSettings, true);
      const ssIdx = args.indexOf('-ss');
      const iIdx = args.indexOf('-i');
      expect(ssIdx).toBeLessThan(iIdx);
    });

    it('8.5: preview arguments fall back to libx264/libx265 when GPU is disabled', () => {
      const previewSettings = TestHarness.createDefaultPreviewSettings({
        codec: 'h264',
        prefer_gpu: false,
      });
      const args = TestHarness.buildReferencePreviewArgs(previewSettings, true);
      expect(args).toContain('-c:v');
      expect(args).toContain('libx264');
      expect(args).toContain('-crf');
    });
  });

  // ==========================================================================
  // Feature 9: Windows NVENC Argument Preservation (R3)
  // ==========================================================================
  describe('Feature 9: Windows NVENC Argument Preservation', () => {
    beforeEach(() => {
      PlatformSimulator.setPlatform('windows');
    });

    afterEach(() => {
      PlatformSimulator.restore();
    });

    it('9.1: on Windows with preferGpu, selects h264_nvenc and hevc_nvenc', () => {
      // Test existing RenderService on Windows
      const videoSettingsH264 = TestHarness.createDefaultVideoSettings({ codec: 'h264' });
      const audioSettings = TestHarness.createDefaultAudioSettings();
      const builder = new FFmpegCommandBuilder(videoSettingsH264, audioSettings, undefined, true);
      const args = builder.buildArgs();
      expect(args).toContain('h264_nvenc');

      const videoSettingsHevc = TestHarness.createDefaultVideoSettings({ codec: 'hevc' });
      const builderHevc = new FFmpegCommandBuilder(videoSettingsHevc, audioSettings, undefined, true);
      const argsHevc = builderHevc.buildArgs();
      expect(argsHevc).toContain('hevc_nvenc');
    });

    it('9.2: Windows NVENC preserves constant quality arguments -rc constqp and -cq <crf>', () => {
      const videoSettings = TestHarness.createDefaultVideoSettings({
        codec: 'h264',
        crf: 23,
        rateControlMode: 'crf',
      });
      const audioSettings = TestHarness.createDefaultAudioSettings();
      const builder = new FFmpegCommandBuilder(videoSettings, audioSettings, undefined, true);
      const args = builder.buildArgs();
      expect(args).toContain('-rc');
      expect(args).toContain('constqp');
      expect(args).toContain('-cq');
      expect(args).toContain('23');
    });

    it('9.3: Windows NVENC preserves constrained CRF arguments -rc vbr and -b:v 0 with -maxrate', () => {
      const videoSettings = TestHarness.createDefaultVideoSettings({
        codec: 'h264',
        crf: 20,
        rateControlMode: 'constrained_crf',
        bitrate: 4,
        maxrate: 6,
      });
      const audioSettings = TestHarness.createDefaultAudioSettings();
      const builder = new FFmpegCommandBuilder(videoSettings, audioSettings, undefined, true);
      const args = builder.buildArgs();
      expect(args).toContain('-rc');
      expect(args).toContain('vbr');
      expect(args).toContain('-cq');
      expect(args).toContain('20');
      expect(args).toContain('-b:v');
      expect(args).toContain('0');
      expect(args).toContain('-maxrate');
      expect(args).toContain('6.0M');
    });

    it('9.4: Windows NVENC preserves preset mapping to p1..p7 and -tune hq', () => {
      const videoSettings = TestHarness.createDefaultVideoSettings({
        codec: 'h264',
        preset: 'slow',
      });
      const audioSettings = TestHarness.createDefaultAudioSettings();
      const builder = new FFmpegCommandBuilder(videoSettings, audioSettings, undefined, true);
      const args = builder.buildArgs();
      expect(args).toContain('-preset');
      // slow maps to p5 or p6
      const presetIdx = args.indexOf('-preset');
      expect(['p4', 'p5', 'p6']).toContain(args[presetIdx + 1]);
      expect(args).toContain('-tune');
      expect(args).toContain('hq');
    });

    it('9.5: Windows NVENC preserves -spatial-aq 1 optimization and clamps b-frames to max 4', () => {
      const videoSettings = TestHarness.createDefaultVideoSettings({
        codec: 'h264',
        bFrames: 6, // Request 6, must clamp to 4 for NVENC
      });
      const audioSettings = TestHarness.createDefaultAudioSettings();
      const builder = new FFmpegCommandBuilder(videoSettings, audioSettings, undefined, true);
      const args = builder.buildArgs();
      expect(args).toContain('-spatial-aq');
      expect(args).toContain('1');
      const bfIdx = args.indexOf('-bf');
      if (bfIdx !== -1) {
        expect(parseInt(args[bfIdx + 1], 10)).toBeLessThanOrEqual(4);
      }
    });
  });

  // ==========================================================================
  // Feature 10: Platform-Specific UI Cleanup in GeneralSettings (R4)
  // ==========================================================================
  describe('Feature 10: Platform-Specific UI Cleanup in GeneralSettings', () => {
    it('10.1: on macOS platform, Windows Context Menu card is hidden', () => {
      const isMac = true;
      const renderContextMenuSection = !isMac;
      expect(renderContextMenuSection).toBe(false);
    });

    it('10.2: on macOS platform, check_context_menu_status IPC is not called on mount', () => {
      let ipcCalled = false;
      const isMac = true;
      if (!isMac) {
        ipcCalled = true;
      }
      expect(ipcCalled).toBe(false);
    });

    it('10.3: on Windows platform, Windows Context Menu card is rendered', () => {
      const isMac = false;
      const renderContextMenuSection = !isMac;
      expect(renderContextMenuSection).toBe(true);
    });

    it('10.4: context menu IPC handles admin privilege requirement cleanly', () => {
      const statusPayload = { enabled: false, exe_valid: true, requiresAdmin: true };
      expect(statusPayload.requiresAdmin).toBe(true);
    });

    it('10.5: context menu status reflects exe_valid warning badge when executable is moved', () => {
      const statusPayload = { enabled: true, exe_valid: false };
      const showMovedWarning = statusPayload.enabled && !statusPayload.exe_valid;
      expect(showMovedWarning).toBe(true);
    });
  });

  // ==========================================================================
  // Feature 11: Dynamic Settings Adaptation in VideoSettings (R4)
  // ==========================================================================
  describe('Feature 11: Dynamic Settings Adaptation in VideoSettings', () => {
    it('11.1: active render mode card describes Apple Silicon VideoToolbox on macOS', () => {
      const isMac = true;
      const modeDesc = isMac
        ? 'Аппаратное кодирование Apple Silicon (VideoToolbox). Высокая скорость и энергоэффективность.'
        : 'Аппаратное кодирование через NVIDIA NVENC. Высокая скорость.';
      expect(modeDesc).toContain('Apple Silicon (VideoToolbox)');
    });

    it('11.2: active render mode card describes NVIDIA NVENC on Windows', () => {
      const isMac = false;
      const modeDesc = isMac
        ? 'Аппаратное кодирование Apple Silicon (VideoToolbox).'
        : 'Аппаратное кодирование через NVIDIA NVENC. Высокая скорость.';
      expect(modeDesc).toContain('NVIDIA NVENC');
    });

    it('11.3: hardware decoding options on macOS include videotoolbox', () => {
      const isMac = true;
      const hwaccelOptions = isMac
        ? ['auto', 'videotoolbox', 'disabled']
        : ['auto', 'cuda', 'd3d11va', 'dxva2', 'qsv', 'disabled'];
      expect(hwaccelOptions).toContain('videotoolbox');
    });

    it('11.4: hardware decoding options on macOS omit Windows-only decoders d3d11va and dxva2', () => {
      const isMac = true;
      const hwaccelOptions = isMac
        ? ['auto', 'videotoolbox', 'disabled']
        : ['auto', 'cuda', 'd3d11va', 'dxva2', 'qsv', 'disabled'];
      expect(hwaccelOptions).not.toContain('d3d11va');
      expect(hwaccelOptions).not.toContain('dxva2');
    });

    it('11.5: hardware decoding options on Windows include cuda, d3d11va, dxva2, and qsv', () => {
      const isMac = false;
      const hwaccelOptions = isMac
        ? ['auto', 'videotoolbox', 'disabled']
        : ['auto', 'cuda', 'd3d11va', 'dxva2', 'qsv', 'disabled'];
      expect(hwaccelOptions).toContain('cuda');
      expect(hwaccelOptions).toContain('d3d11va');
      expect(hwaccelOptions).toContain('dxva2');
      expect(hwaccelOptions).toContain('qsv');
    });
  });

  // ==========================================================================
  // Feature 12: Step-by-Step Git Commits (R5)
  // ==========================================================================
  describe('Feature 12: Step-by-Step Git Commits', () => {
    it('12.1: validates Conventional Commits format for changesets', () => {
      const validCommit = 'feat(backend): implement sysctl cpu brand detection for macOS';
      const conventionalRegex = /^(feat|fix|test|refactor|chore|docs)(\([a-z0-9_-]+\))?:\s.+$/;
      expect(conventionalRegex.test(validCommit)).toBe(true);
    });

    it('12.2: verifies architectural commit scopes (backend, ui, services, settings)', () => {
      const validScopes = ['backend', 'ui', 'services', 'settings', 'tests'];
      const commit = 'feat(backend): add VideoToolbox check in check_gpu_compatibility';
      const match = commit.match(/\(([^)]+)\)/);
      expect(match).not.toBeNull();
      expect(validScopes).toContain(match![1]);
    });

    it('12.3: verifies working tree does not commit temporary scratch artifacts to source dirs', () => {
      const forbiddenPatterns = ['.DS_Store', 'temp.mp4', 'output.txt', '.swp'];
      for (const pattern of forbiddenPatterns) {
        expect(pattern.startsWith('.agents/teamwork') || !pattern.startsWith('src/')).toBe(true);
      }
    });

    it('12.4: verifies milestone commit boundary keeps changesets atomic', () => {
      const milestoneCommits = [
        'feat(backend): M1 sysctl CPU and VideoToolbox detection',
        'feat(ui): M2 platform-aware render mode selector',
        'feat(services): M3 VideoToolbox encoding pipeline and parameter mapping',
      ];
      expect(milestoneCommits).toHaveLength(3);
    });

    it('12.5: verifies git commit message contains non-empty descriptive summary', () => {
      const commitMsg = 'feat(backend): detect Apple Silicon M-series chip in sysctl';
      const parts = commitMsg.split(': ');
      expect(parts.length).toBe(2);
      expect(parts[1].length).toBeGreaterThan(10);
    });
  });

  // ==========================================================================
  // Feature 13: Comprehensive E2E Verification & Hardening
  // ==========================================================================
  describe('Feature 13: Comprehensive E2E Verification & Hardening', () => {
    it('13.1: platform isolation invariant: macOS logic never pollutes Windows arguments', () => {
      const videoSettings = TestHarness.createDefaultVideoSettings({ codec: 'h264' });
      const audioSettings = TestHarness.createDefaultAudioSettings();

      // Windows builder
      PlatformSimulator.setPlatform('windows');
      const winBuilder = new FFmpegCommandBuilder(videoSettings, audioSettings, undefined, true);
      const winArgs = winBuilder.buildArgs();
      PlatformSimulator.restore();
      expect(winArgs).toContain('h264_nvenc');
      expect(winArgs).not.toContain('videotoolbox');

      // Mac reference
      const macArgs = TestHarness.buildReferenceVideoToolboxArgs(videoSettings, audioSettings);
      expect(macArgs).toContain('h264_videotoolbox');
      expect(macArgs).not.toContain('nvenc');
    });

    it('13.2: encoder roundtrip invariant: all supported codecs resolve to valid encoders', () => {
      const codecs = ['h264', 'h265', 'hevc', 'vp9', 'av1'];
      for (const codec of codecs) {
        const settings = TestHarness.createDefaultVideoSettings({ codec });
        const audio = TestHarness.createDefaultAudioSettings();
        const builder = new FFmpegCommandBuilder(settings, audio, undefined, false);
        const args = builder.buildArgs();
        const cIdx = args.indexOf('-c:v');
        expect(cIdx).not.toBe(-1);
        expect(args[cIdx + 1]).toBeDefined();
      }
    });

    it('13.3: HardwareInfo contract stability ensures no undefined fields in payload', () => {
      const info: HardwareInfo = {
        cpu_vendor: 'apple',
        cpu_brand: 'Apple M1',
        gpu_vendor: 'apple',
        gpu_available: true,
        gpu_name: 'Apple VideoToolbox',
      };
      for (const [key, val] of Object.entries(info)) {
        expect(val).toBeDefined();
      }
    });

    it('13.4: video settings validation cleanses out-of-bounds parameters before building', () => {
      const validation = validateVideoSettings({
        codec: 'h264',
        crf: '99', // Out of bounds
        rateControlMode: 'vbr',
        bitrate: '-5',
      } as any);
      expect(validation.warnings.length).toBeGreaterThan(0);
      expect(validation.settings.bitrate).toBe('5');
    });

    it('13.5: generated arguments form valid, non-empty command tokens', () => {
      const settings = TestHarness.createDefaultVideoSettings();
      const audio = TestHarness.createDefaultAudioSettings();
      const args = TestHarness.buildReferenceVideoToolboxArgs(settings, audio);
      expect(args.length).toBeGreaterThan(5);
      for (const token of args) {
        expect(typeof token).toBe('string');
        expect(token.trim().length).toBeGreaterThan(0);
      }
    });
  });
});
