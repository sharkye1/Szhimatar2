/**
 * Empirical Stress Test Suite for Milestone 3:
 * VideoToolbox Pipeline Adaptation, Rate Control Mapping, Windows Non-Regression,
 * Codec Fallbacks, and HW Decoding Protection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FFmpegCommandBuilder, calculateVideoToolboxQuality } from '../../src/services/RenderService';
import { RenderScheduler, sanitizeRenderMode } from '../../src/services/RenderScheduler';
import { PlatformSimulator } from '../e2e/harness/platformSimulator';
import { HardwareOracle } from '../e2e/harness/hardwareOracle';
import type { VideoSettings, AudioSettings } from '../../src/types';

describe('Milestone 3 Empirical Adversarial Stress Testing', () => {
  const defaultAudio: AudioSettings = {
    codec: 'aac',
    bitrate: '192k',
    sampleRate: '48000',
    channels: '2',
    volume: 1.0,
    normalizeAudio: false,
  };

  const createVideoSettings = (overrides?: Partial<VideoSettings>): VideoSettings => ({
    codec: 'h264',
    crf: '23',
    preset: 'medium',
    rateControlMode: 'crf',
    fps: '30',
    fpsAuto: true,
    bitrate: '5',
    maxrate: '8',
    bFrames: 3,
    targetFormat: 'video',
    hwaccel: 'auto',
    customResolution: false,
    keepAudio: true,
    gopSize: 'auto',
    nvencMultipass: 'disabled',
    ...overrides,
  });

  beforeEach(() => {
    PlatformSimulator.restore();
  });

  afterEach(() => {
    PlatformSimulator.restore();
  });

  // ==========================================================================
  // 1. Lossless CRF 0 & Boundary Rate Control Clamping Stress
  // ==========================================================================
  describe('1. CRF 0 (Lossless) and Mathematical Inversion Stress', () => {
    it('1.1: CRF 0 as integer number maps to -q:v 100 without being coerced to default 23', () => {
      const v = createVideoSettings({ codec: 'h264', crf: 0 as any });
      const builder = new FFmpegCommandBuilder(v, defaultAudio, undefined, true, '', true);
      const args = builder.buildArgs();

      expect(args).toContain('-c:v');
      expect(args).toContain('h264_videotoolbox');
      const qIdx = args.indexOf('-q:v');
      expect(qIdx).not.toBe(-1);
      expect(args[qIdx + 1]).toBe('100');
      // Assert it did NOT reset to default CRF 23 (-q:v 55)
      expect(args).not.toContain('55');
    });

    it('1.2: CRF "0" as string literal maps to -q:v 100 on macOS VideoToolbox', () => {
      const v = createVideoSettings({ codec: 'h264', crf: '0' });
      const builder = new FFmpegCommandBuilder(v, defaultAudio, undefined, true, '', true);
      const args = builder.buildArgs();

      const qIdx = args.indexOf('-q:v');
      expect(qIdx).not.toBe(-1);
      expect(args[qIdx + 1]).toBe('100');
    });

    it('1.3: calculateVideoToolboxQuality edge cases and clamp boundaries', () => {
      // 0 -> 100
      expect(calculateVideoToolboxQuality(0)).toBe(100);
      // Negative -> clamped to 100
      expect(calculateVideoToolboxQuality(-10)).toBe(100);
      // 51 -> 1
      expect(calculateVideoToolboxQuality(51)).toBe(1);
      // > 51 -> clamped to 1
      expect(calculateVideoToolboxQuality(100)).toBe(1);
      // NaN -> falls back to default 55
      expect(calculateVideoToolboxQuality(NaN)).toBe(55);
      // Monotonic descent test: quality must strictly decrease as CRF increases
      let prevQ = 101;
      for (let crf = 0; crf <= 51; crf++) {
        const q = calculateVideoToolboxQuality(crf);
        expect(q).toBeLessThanOrEqual(prevQ);
        expect(q).toBeGreaterThanOrEqual(1);
        expect(q).toBeLessThanOrEqual(100);
        prevQ = q;
      }
    });

    it('1.4: CRF falsy inputs: null, undefined, empty string cleanly fall back to default CRF 23 (-q:v 55)', () => {
      const cases: any[] = [null, undefined, '', 'invalid_string'];
      for (const crfVal of cases) {
        const v = createVideoSettings({ codec: 'h264', crf: crfVal });
        const builder = new FFmpegCommandBuilder(v, defaultAudio, undefined, true, '', true);
        const args = builder.buildArgs();
        const qIdx = args.indexOf('-q:v');
        expect(qIdx).not.toBe(-1);
        expect(args[qIdx + 1]).toBe('55');
      }
    });

    it('1.5: Constrained CRF on macOS applies both -q:v and -b:v / -maxrate without NVENC flags', () => {
      const v = createVideoSettings({
        codec: 'h264',
        rateControlMode: 'constrained_crf',
        crf: '18',
        bitrate: '6.5',
        maxrate: '10',
      });
      const builder = new FFmpegCommandBuilder(v, defaultAudio, undefined, true, '', true);
      const args = builder.buildArgs();

      expect(args).toContain('-q:v');
      expect(args).toContain('65');
      expect(args).toContain('-b:v');
      expect(args).toContain('6.5M');
      expect(args).toContain('-maxrate');
      expect(args).toContain('10M');
      // Must not contain NVENC rate control flags
      expect(args).not.toContain('-rc');
      expect(args).not.toContain('-cq');
      expect(args).not.toContain('-qmin');
      expect(args).not.toContain('-qmax');
    });
  });

  // ==========================================================================
  // 2. Unsupported Codecs & Graceful CPU Fallback on macOS Hardware Mode
  // ==========================================================================
  describe('2. Unsupported Codec Fallback in macOS Hardware Mode', () => {
    it('2.1: AV1 on macOS Hardware mode falls back to libaom-av1 with CPU params', () => {
      const v = createVideoSettings({ codec: 'av1', crf: '30' });
      const builder = new FFmpegCommandBuilder(v, defaultAudio, undefined, true, '', true);
      const args = builder.buildArgs();

      expect(args).toContain('-c:v');
      expect(args).toContain('libaom-av1');
      expect(args).not.toContain('videotoolbox');
      expect(args).not.toContain('nvenc');
      // CPU CRF params
      expect(args).toContain('-crf');
      expect(args).toContain('30');
      expect(args).toContain('-b:v');
      expect(args).toContain('0'); // VP9/AV1 CRF requires -b:v 0
    });

    it('2.2: VP9 on macOS Hardware mode falls back to libvpx-vp9 with CPU params', () => {
      const v = createVideoSettings({ codec: 'vp9', crf: '28' });
      const builder = new FFmpegCommandBuilder(v, defaultAudio, undefined, true, '', true);
      const args = builder.buildArgs();

      expect(args).toContain('-c:v');
      expect(args).toContain('libvpx-vp9');
      expect(args).toContain('-crf');
      expect(args).toContain('28');
      expect(args).toContain('-b:v');
      expect(args).toContain('0');
    });

    it('2.3: ProRes on macOS Hardware mode falls back to prores_ks', () => {
      const v = createVideoSettings({ codec: 'prores' });
      const builder = new FFmpegCommandBuilder(v, defaultAudio, undefined, true, '', true);
      const args = builder.buildArgs();

      expect(args).toContain('-c:v');
      expect(args).toContain('prores_ks');
    });

    it('2.4: MPEG4 on macOS Hardware mode falls back to mpeg4', () => {
      const v = createVideoSettings({ codec: 'mpeg4' });
      const builder = new FFmpegCommandBuilder(v, defaultAudio, undefined, true, '', true);
      const args = builder.buildArgs();

      expect(args).toContain('-c:v');
      expect(args).toContain('mpeg4');
    });
  });

  // ==========================================================================
  // 3. Hardware Decoding (`hwaccel`) Sanitization and Cross-Platform Protection
  // ==========================================================================
  describe('3. Hardware Decoding (hwaccel) Cross-Platform Sanitization', () => {
    it('3.1: on macOS, Windows-specific decoders (cuda, d3d11va, dxva2, qsv) are safely normalized to auto', () => {
      const windowsDecoders: Array<'cuda' | 'd3d11va' | 'dxva2' | 'qsv'> = ['cuda', 'd3d11va', 'dxva2', 'qsv'];
      for (const hw of windowsDecoders) {
        const v = createVideoSettings({ hwaccel: hw });
        const builder = new FFmpegCommandBuilder(v, defaultAudio, undefined, true, '', true);
        const args = builder.buildArgs();

        const hwIdx = args.indexOf('-hwaccel');
        expect(hwIdx).not.toBe(-1);
        expect(args[hwIdx + 1]).toBe('auto');
        expect(args).not.toContain(hw);
      }
    });

    it('3.2: on macOS, videotoolbox and auto decoders are preserved unmodified', () => {
      const vVt = createVideoSettings({ hwaccel: 'videotoolbox' });
      const bVt = new FFmpegCommandBuilder(vVt, defaultAudio, undefined, true, '', true);
      const argsVt = bVt.buildArgs();
      const idxVt = argsVt.indexOf('-hwaccel');
      expect(argsVt[idxVt + 1]).toBe('videotoolbox');

      const vAuto = createVideoSettings({ hwaccel: 'auto' });
      const bAuto = new FFmpegCommandBuilder(vAuto, defaultAudio, undefined, true, '', true);
      const argsAuto = bAuto.buildArgs();
      const idxAuto = argsAuto.indexOf('-hwaccel');
      expect(argsAuto[idxAuto + 1]).toBe('auto');
    });

    it('3.3: on Windows, videotoolbox decoder is normalized to auto, while cuda and d3d11va are preserved', () => {
      const vVt = createVideoSettings({ hwaccel: 'videotoolbox' });
      const bVt = new FFmpegCommandBuilder(vVt, defaultAudio, undefined, true, '', false);
      const argsVt = bVt.buildArgs();
      const idxVt = argsVt.indexOf('-hwaccel');
      expect(argsVt[idxVt + 1]).toBe('auto');

      const vCuda = createVideoSettings({ hwaccel: 'cuda' });
      const bCuda = new FFmpegCommandBuilder(vCuda, defaultAudio, undefined, true, '', false);
      const argsCuda = bCuda.buildArgs();
      const idxCuda = argsCuda.indexOf('-hwaccel');
      expect(argsCuda[idxCuda + 1]).toBe('cuda');
    });

    it('3.4: disabled hwaccel suppresses -hwaccel argument on both platforms', () => {
      const vDis = createVideoSettings({ hwaccel: 'disabled' });
      const bMac = new FFmpegCommandBuilder(vDis, defaultAudio, undefined, true, '', true);
      expect(bMac.buildArgs()).not.toContain('-hwaccel');

      const bWin = new FFmpegCommandBuilder(vDis, defaultAudio, undefined, true, '', false);
      expect(bWin.buildArgs()).not.toContain('-hwaccel');
    });
  });

  // ==========================================================================
  // 4. Windows NVENC Byte-for-Byte Non-Regression & DUO Preservation
  // ==========================================================================
  describe('4. Windows NVENC and DUO Non-Regression', () => {
    it('4.1: Windows NVENC preserves all rate control modes byte-for-byte', () => {
      // 1. CRF mode
      const vCrf = createVideoSettings({ codec: 'h264', rateControlMode: 'crf', crf: '21' });
      const bCrf = new FFmpegCommandBuilder(vCrf, defaultAudio, undefined, true, '', false);
      const argsCrf = bCrf.buildArgs();
      expect(argsCrf).toContain('h264_nvenc');
      expect(argsCrf).toContain('-rc');
      expect(argsCrf[argsCrf.indexOf('-rc') + 1]).toBe('constqp');
      expect(argsCrf).toContain('-cq');
      expect(argsCrf[argsCrf.indexOf('-cq') + 1]).toBe('21');
      expect(argsCrf).toContain('-qp');
      expect(argsCrf[argsCrf.indexOf('-qp') + 1]).toBe('21');

      // 2. Constrained CRF mode
      const vCbrCrf = createVideoSettings({
        codec: 'h264',
        rateControlMode: 'constrained_crf',
        crf: '20',
        bitrate: '5',
        maxrate: '8',
      });
      const bCbrCrf = new FFmpegCommandBuilder(vCbrCrf, defaultAudio, undefined, true, '', false);
      const argsCbrCrf = bCbrCrf.buildArgs();
      expect(argsCbrCrf).toContain('-rc');
      expect(argsCbrCrf[argsCbrCrf.indexOf('-rc') + 1]).toBe('vbr');
      expect(argsCbrCrf).toContain('-b:v');
      expect(argsCbrCrf[argsCbrCrf.indexOf('-b:v') + 1]).toBe('0');
      expect(argsCbrCrf).toContain('-maxrate');
      expect(argsCbrCrf[argsCbrCrf.indexOf('-maxrate') + 1]).toBe('8.0M');

      // 3. CBR mode
      const vCbr = createVideoSettings({ codec: 'h264', rateControlMode: 'cbr', bitrate: '10' });
      const bCbr = new FFmpegCommandBuilder(vCbr, defaultAudio, undefined, true, '', false);
      const argsCbr = bCbr.buildArgs();
      expect(argsCbr).toContain('-rc');
      expect(argsCbr[argsCbr.indexOf('-rc') + 1]).toBe('cbr');
      expect(argsCbr).toContain('-minrate');
      expect(argsCbr[argsCbr.indexOf('-minrate') + 1]).toBe('10M');
      expect(argsCbr).toContain('-maxrate');
      expect(argsCbr[argsCbr.indexOf('-maxrate') + 1]).toBe('10M');

      // 4. VBR mode
      const vVbr = createVideoSettings({ codec: 'h264', rateControlMode: 'vbr', bitrate: '4', maxrate: '6' });
      const bVbr = new FFmpegCommandBuilder(vVbr, defaultAudio, undefined, true, '', false);
      const argsVbr = bVbr.buildArgs();
      expect(argsVbr).toContain('-rc');
      expect(argsVbr[argsVbr.indexOf('-rc') + 1]).toBe('vbr');
      expect(argsVbr).toContain('-b:v');
      expect(argsVbr[argsVbr.indexOf('-b:v') + 1]).toBe('4M');
      expect(argsVbr).toContain('-maxrate');
      expect(argsVbr[argsVbr.indexOf('-maxrate') + 1]).toBe('6.0M');
    });

    it('4.2: Windows NVENC preserves hardware optimizations (AQ, B-frames, multipass, presets)', () => {
      const v = createVideoSettings({
        codec: 'h264',
        preset: 'slow',
        nvencMultipass: 'fullres',
        bFrames: 4,
      });
      const b = new FFmpegCommandBuilder(v, defaultAudio, undefined, true, '', false);
      const args = b.buildArgs();

      expect(args).toContain('-spatial-aq');
      expect(args[args.indexOf('-spatial-aq') + 1]).toBe('1');
      expect(args).toContain('-temporal-aq');
      expect(args[args.indexOf('-temporal-aq') + 1]).toBe('1');
      expect(args).toContain('-multipass');
      expect(args[args.indexOf('-multipass') + 1]).toBe('fullres');
      expect(args).toContain('-bf');
      expect(args[args.indexOf('-bf') + 1]).toBe('4');
      expect(args).toContain('-b_ref_mode');
      expect(args[args.indexOf('-b_ref_mode') + 1]).toBe('middle');
      expect(args).toContain('-preset');
      expect(args[args.indexOf('-preset') + 1]).toBe('p6'); // slow -> p6
      expect(args).toContain('-tune');
      expect(args[args.indexOf('-tune') + 1]).toBe('hq');
    });

    it('4.3: Windows DUO mode preserves concurrent two-slot dispatch in RenderScheduler', () => {
      // Simulate Windows platform
      PlatformSimulator.setPlatform('windows');
      const scheduler = new RenderScheduler(false);
      scheduler.setGpuAvailable(true);
      scheduler.setMode('duo');

      expect(scheduler.getMode()).toBe('duo');

      // Enqueue 2 jobs
      scheduler.enqueue('job-1');
      scheduler.enqueue('job-2');

      const dispatched = scheduler.planNext(() => true);
      // Both GPU and CPU slots must be dispatched
      expect(dispatched).toHaveLength(2);
      expect(dispatched[0]).toEqual({ jobId: 'job-1', slot: 'gpu' });
      expect(dispatched[1]).toEqual({ jobId: 'job-2', slot: 'cpu' });

      // Occupy slots
      scheduler.occupy('job-1', 'gpu');
      scheduler.occupy('job-2', 'cpu');

      // Next plan when slots busy must be empty
      expect(scheduler.planNext(() => true)).toHaveLength(0);

      // Release GPU slot: next job dispatched to GPU
      scheduler.enqueue('job-3');
      scheduler.release('job-1');
      const dispatchedNext = scheduler.planNext(() => true);
      expect(dispatchedNext).toEqual([{ jobId: 'job-3', slot: 'gpu' }]);
    });
  });

  // ==========================================================================
  // 5. Host VideoToolbox FFmpeg Live Execution Verification
  // ==========================================================================
  describe('5. Host VideoToolbox FFmpeg Live Execution', () => {
    it('5.1: Live FFmpeg executes H.264 VideoToolbox with generated -q:v argument', () => {
      const v = createVideoSettings({ codec: 'h264', crf: '20' });
      const builder = new FFmpegCommandBuilder(v, defaultAudio, undefined, true, '', true);
      const args = builder.buildArgs();

      // Extract encoder and quality args
      const encoder = args[args.indexOf('-c:v') + 1];
      const qVal = args[args.indexOf('-q:v') + 1];

      const ffmpegArgs = ['-c:v', encoder, '-q:v', qVal];
      const result = HardwareOracle.executeFfmpegWithArgs(ffmpegArgs, 0.5);
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
    });

    it('5.2: Live FFmpeg executes HEVC VideoToolbox with generated -q:v argument', () => {
      const v = createVideoSettings({ codec: 'hevc', crf: '24' });
      const builder = new FFmpegCommandBuilder(v, defaultAudio, undefined, true, '', true);
      const args = builder.buildArgs();

      const encoder = args[args.indexOf('-c:v') + 1];
      const qVal = args[args.indexOf('-q:v') + 1];

      const ffmpegArgs = ['-c:v', encoder, '-q:v', qVal];
      const result = HardwareOracle.executeFfmpegWithArgs(ffmpegArgs, 0.5);
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
    });

    it('5.3: Live FFmpeg execution confirms NVENC flags (-spatial-aq, -cq) crash or error on VideoToolbox', () => {
      const illegalArgs = ['-c:v', 'h264_videotoolbox', '-spatial-aq', '1'];
      const result = HardwareOracle.executeFfmpegWithArgs(illegalArgs, 0.5);
      expect(result.success).toBe(false);
      expect(result.stderr).toContain("Unrecognized option 'spatial-aq'");
    });
  });
});
