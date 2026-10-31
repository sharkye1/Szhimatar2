/**
 * Empirical Stress Test Suite for Milestone 2:
 * Platform-Specific Render Modes, Mode Sanitization, and Platform Utilities.
 * 
 * Verifies:
 * 1. Truth table for `sanitizeRenderMode` across all combinations of
 *    (mode: 'cpu' | 'gpu' | 'duo' | invalid, isMac: true | false, gpuAvailable: true | false)
 * 2. High-volume queue stress (500 - 1000 jobs) on `RenderScheduler`:
 *    - Invariant: No dual-slot dispatch ever occurs on macOS (isMac = true).
 *    - Invariant: Dual-slot dispatch works concurrently on Windows (isMac = false) in DUO mode.
 *    - Invariant: FIFO queue ordering and deduplication hold deterministically.
 * 3. Platform spoofing and mutations in `src/utils/platform.ts`:
 *    - navigator.platform / userAgentData / userAgent spoofing
 *    - process.platform / process.arch spoofing
 *    - Missing/corrupted globals (undefined navigator/process)
 *    - Zero-latency dynamic re-evaluation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sanitizeRenderMode, RenderScheduler, RenderMode } from '../../src/services/RenderScheduler';
import {
  getPlatformOS,
  getPlatformArch,
  isMacOS,
  isWindows,
  isLinux,
  isAppleSilicon,
  getPlatformKey,
  detectPlatformInfo,
  setPlatformOverride,
  resetPlatformOverride,
} from '../../src/utils/platform';

describe('Milestone 2 Empirical Stress Testing', () => {
  // Store originals for clean restoration
  const originalProcessPlatform = process.platform;
  const originalProcessArch = process.arch;
  const originalNavigator = (globalThis as any).navigator;

  beforeEach(() => {
    resetPlatformOverride();
  });

  afterEach(() => {
    resetPlatformOverride();
    Object.defineProperty(process, 'platform', { value: originalProcessPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: originalProcessArch, configurable: true });
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  // ==========================================================================
  // 1. Truth Table Stress: sanitizeRenderMode
  // ==========================================================================
  describe('1. Mode Sanitization Truth Table & Edge Cases', () => {
    const truthTableCases: Array<{
      mode: any;
      isMac: boolean;
      gpuAvailable: boolean;
      expected: RenderMode;
      label: string;
    }> = [
      // macOS cases (DUO forbidden, coerced to GPU or CPU)
      { mode: 'cpu', isMac: true, gpuAvailable: true, expected: 'cpu', label: 'macOS: cpu with GPU available -> cpu' },
      { mode: 'cpu', isMac: true, gpuAvailable: false, expected: 'cpu', label: 'macOS: cpu without GPU -> cpu' },
      { mode: 'gpu', isMac: true, gpuAvailable: true, expected: 'gpu', label: 'macOS: gpu with GPU available -> gpu' },
      { mode: 'gpu', isMac: true, gpuAvailable: false, expected: 'cpu', label: 'macOS: gpu without GPU -> fallback to cpu' },
      { mode: 'duo', isMac: true, gpuAvailable: true, expected: 'gpu', label: 'macOS: duo with GPU available -> sanitized to gpu' },
      { mode: 'duo', isMac: true, gpuAvailable: false, expected: 'cpu', label: 'macOS: duo without GPU -> sanitized to cpu' },

      // Windows/Linux cases (DUO allowed if GPU available)
      { mode: 'cpu', isMac: false, gpuAvailable: true, expected: 'cpu', label: 'Windows: cpu with GPU available -> cpu' },
      { mode: 'cpu', isMac: false, gpuAvailable: false, expected: 'cpu', label: 'Windows: cpu without GPU -> cpu' },
      { mode: 'gpu', isMac: false, gpuAvailable: true, expected: 'gpu', label: 'Windows: gpu with GPU available -> gpu' },
      { mode: 'gpu', isMac: false, gpuAvailable: false, expected: 'cpu', label: 'Windows: gpu without GPU -> fallback to cpu' },
      { mode: 'duo', isMac: false, gpuAvailable: true, expected: 'duo', label: 'Windows: duo with GPU available -> duo preserved' },
      { mode: 'duo', isMac: false, gpuAvailable: false, expected: 'cpu', label: 'Windows: duo without GPU -> fallback to cpu' },

      // Malformed / Adversarial inputs on macOS
      { mode: 'DUO', isMac: true, gpuAvailable: true, expected: 'cpu', label: 'macOS: uppercase DUO -> fallback to cpu' },
      { mode: 'Gpu', isMac: true, gpuAvailable: true, expected: 'cpu', label: 'macOS: mixed-case Gpu -> fallback to cpu' },
      { mode: '', isMac: true, gpuAvailable: true, expected: 'cpu', label: 'macOS: empty string -> fallback to cpu' },
      { mode: 'invalid_mode_xyz', isMac: true, gpuAvailable: true, expected: 'cpu', label: 'macOS: arbitrary string -> fallback to cpu' },
      { mode: null, isMac: true, gpuAvailable: true, expected: 'cpu', label: 'macOS: null mode -> fallback to cpu' },
      { mode: undefined, isMac: true, gpuAvailable: true, expected: 'cpu', label: 'macOS: undefined mode -> fallback to cpu' },
      { mode: 12345, isMac: true, gpuAvailable: true, expected: 'cpu', label: 'macOS: numeric mode -> fallback to cpu' },
      { mode: {}, isMac: true, gpuAvailable: true, expected: 'cpu', label: 'macOS: object mode -> fallback to cpu' },

      // Malformed / Adversarial inputs on Windows
      { mode: 'DUO', isMac: false, gpuAvailable: true, expected: 'cpu', label: 'Windows: uppercase DUO -> fallback to cpu' },
      { mode: '', isMac: false, gpuAvailable: true, expected: 'cpu', label: 'Windows: empty string -> fallback to cpu' },
      { mode: 'cuda', isMac: false, gpuAvailable: true, expected: 'cpu', label: 'Windows: unknown mode -> fallback to cpu' },
      { mode: null, isMac: false, gpuAvailable: true, expected: 'cpu', label: 'Windows: null mode -> fallback to cpu' },
      { mode: undefined, isMac: false, gpuAvailable: true, expected: 'cpu', label: 'Windows: undefined mode -> fallback to cpu' },
    ];

    truthTableCases.forEach(({ mode, isMac, gpuAvailable, expected, label }) => {
      it(`truth table: ${label}`, () => {
        const result = sanitizeRenderMode(mode, isMac, gpuAvailable);
        expect(result).toBe(expected);
      });
    });

    it('defaults isMac to isMacOS() when isMac argument is omitted', () => {
      // Simulate macOS
      setPlatformOverride('macos');
      expect(sanitizeRenderMode('duo', undefined, true)).toBe('gpu');

      // Simulate Windows
      setPlatformOverride('windows');
      expect(sanitizeRenderMode('duo', undefined, true)).toBe('duo');
    });
  });

  // ==========================================================================
  // 2. High-Volume Queue Stress: RenderScheduler
  // ==========================================================================
  describe('2. RenderScheduler High-Volume Queue Stress (1000 Jobs)', () => {
    it('macOS Invariant: NEVER dispatches dual slots under high volume (1000 jobs)', () => {
      const jobCount = 1000;
      const scheduler = new RenderScheduler(true); // isMac = true
      scheduler.setGpuAvailable(true);
      scheduler.setMode('duo'); // Attempt to set duo on macOS

      // Verification 1: Mode was sanitized to 'gpu'
      expect(scheduler.getMode()).toBe('gpu');

      // Enqueue 1000 unique jobs
      for (let i = 0; i < jobCount; i++) {
        scheduler.enqueue(`job-mac-${i}`);
      }
      expect(scheduler.getQueue().length).toBe(jobCount);

      const dispatchedJobs: string[] = [];
      const isPending = (id: string) => !dispatchedJobs.includes(id);

      // Simulate scheduler loop
      let iterations = 0;
      const maxIterations = jobCount * 3;

      while (dispatchedJobs.length < jobCount && iterations < maxIterations) {
        iterations++;
        const plan = scheduler.planNext(isPending);

        // INVARIANT 1: macOS must NEVER return more than 1 dispatch target
        expect(plan.length).toBeLessThanOrEqual(1);

        if (plan.length > 0) {
          const target = plan[0];

          // INVARIANT 2: Slot must ALWAYS be 'gpu' (or 'cpu'), never dual
          expect(target.slot).toBe('gpu');

          // INVARIANT 3: CPU slot must remain NULL on macOS in GPU mode
          const slotsBefore = scheduler.getSlots();
          expect(slotsBefore.cpuSlot).toBeNull();
          expect(slotsBefore.gpuSlot).toBeNull();

          scheduler.occupy(target.jobId, target.slot);
          dispatchedJobs.push(target.jobId);

          // INVARIANT 4: While GPU slot is occupied, CPU slot remains untouched and planNext returns 0
          const slotsDuring = scheduler.getSlots();
          expect(slotsDuring.gpuSlot).toBe(target.jobId);
          expect(slotsDuring.cpuSlot).toBeNull();

          const emptyPlan = scheduler.planNext(isPending);
          expect(emptyPlan.length).toBe(0);

          // Job finishes -> release slot
          scheduler.release(target.jobId);
          const slotsAfter = scheduler.getSlots();
          expect(slotsAfter.gpuSlot).toBeNull();
          expect(slotsAfter.cpuSlot).toBeNull();
        }
      }

      // Verification: All 1000 jobs processed in strict FIFO order
      expect(dispatchedJobs.length).toBe(jobCount);
      for (let i = 0; i < jobCount; i++) {
        expect(dispatchedJobs[i]).toBe(`job-mac-${i}`);
      }
      expect(scheduler.getQueue().length).toBe(0);
    });

    it('macOS Fallback Invariant: When GPU unavailable, dispatches 1000 jobs sequentially to CPU only', () => {
      const jobCount = 500;
      const scheduler = new RenderScheduler(true); // isMac = true
      scheduler.setGpuAvailable(false);
      scheduler.setMode('duo'); // Duo on macOS with no GPU -> cpu

      expect(scheduler.getMode()).toBe('cpu');

      for (let i = 0; i < jobCount; i++) {
        scheduler.enqueue(`job-mac-cpu-${i}`);
      }

      const completed: string[] = [];
      while (completed.length < jobCount) {
        const plan = scheduler.planNext((id) => !completed.includes(id));
        expect(plan.length).toBe(1);
        expect(plan[0].slot).toBe('cpu');

        const slots = scheduler.getSlots();
        expect(slots.gpuSlot).toBeNull();

        scheduler.occupy(plan[0].jobId, plan[0].slot);
        completed.push(plan[0].jobId);
        scheduler.release(plan[0].jobId);
      }

      expect(completed.length).toBe(jobCount);
    });

    it('Windows DUO Mode: Concurrently dispatches both CPU and GPU slots under high volume', () => {
      const jobCount = 1000;
      const scheduler = new RenderScheduler(false); // isMac = false (Windows)
      scheduler.setGpuAvailable(true);
      scheduler.setMode('duo');

      expect(scheduler.getMode()).toBe('duo');

      for (let i = 0; i < jobCount; i++) {
        scheduler.enqueue(`job-win-${i}`);
      }

      const completedJobs: string[] = [];
      const activeJobs = new Set<string>();
      const isPending = (id: string) => !activeJobs.has(id) && !completedJobs.includes(id);

      let stepCount = 0;
      let dualDispatchOccurrences = 0;

      while (completedJobs.length < jobCount && stepCount < jobCount * 3) {
        stepCount++;
        const plan = scheduler.planNext(isPending);

        if (plan.length === 2) {
          dualDispatchOccurrences++;
          // Expect both GPU and CPU to be dispatched
          const slots = plan.map((p) => p.slot);
          expect(slots).toContain('gpu');
          expect(slots).toContain('cpu');
        }

        for (const item of plan) {
          scheduler.occupy(item.jobId, item.slot);
          activeJobs.add(item.jobId);
        }

        // Simulate random asynchronous completion of active slots
        const currentSlots = scheduler.getSlots();
        if (currentSlots.gpuSlot && (Math.random() > 0.3 || !currentSlots.cpuSlot)) {
          const finishedId = currentSlots.gpuSlot;
          scheduler.release(finishedId);
          activeJobs.delete(finishedId);
          completedJobs.push(finishedId);
        }
        if (currentSlots.cpuSlot && Math.random() > 0.3) {
          const finishedId = currentSlots.cpuSlot;
          scheduler.release(finishedId);
          activeJobs.delete(finishedId);
          completedJobs.push(finishedId);
        }
      }

      // Finish any remaining active jobs
      const finalSlots = scheduler.getSlots();
      if (finalSlots.gpuSlot) {
        scheduler.release(finalSlots.gpuSlot);
        completedJobs.push(finalSlots.gpuSlot);
      }
      if (finalSlots.cpuSlot) {
        scheduler.release(finalSlots.cpuSlot);
        completedJobs.push(finalSlots.cpuSlot);
      }

      expect(completedJobs.length).toBe(jobCount);
      expect(dualDispatchOccurrences).toBeGreaterThan(10);
      expect(scheduler.getQueue().length).toBe(0);
    });

    it('Queue Deduplication & Integrity: Resists 1000 duplicate pushes and mid-queue mutations', () => {
      const scheduler = new RenderScheduler(true);
      scheduler.enqueue('job-1');
      scheduler.enqueue('job-2');

      // Attempt 1000 duplicate enqueues
      for (let i = 0; i < 1000; i++) {
        scheduler.enqueue('job-1');
        scheduler.enqueue('job-2');
      }

      expect(scheduler.getQueue()).toEqual(['job-1', 'job-2']);

      // Remove job-1
      scheduler.remove('job-1');
      expect(scheduler.getQueue()).toEqual(['job-2']);

      // Clear with predicate
      scheduler.enqueue('job-3');
      scheduler.enqueue('job-4');
      scheduler.clear((id) => id === 'job-3');
      expect(scheduler.getQueue()).toEqual(['job-2', 'job-4']);

      // Reset all
      scheduler.resetAll();
      expect(scheduler.getQueue().length).toBe(0);
      expect(scheduler.getSlots().cpuSlot).toBeNull();
      expect(scheduler.getSlots().gpuSlot).toBeNull();
    });

    it('Dynamic GPU failure during active scheduling gracefully evacuates to CPU', () => {
      const scheduler = new RenderScheduler(false); // Windows
      scheduler.setGpuAvailable(true);
      scheduler.setMode('duo');

      scheduler.enqueue('job-1');
      scheduler.enqueue('job-2');

      // Occupy GPU slot
      const plan = scheduler.planNext(() => true);
      expect(plan.length).toBe(2);
      scheduler.occupy('job-1', 'gpu');
      scheduler.occupy('job-2', 'cpu');

      // GPU suddenly fails!
      scheduler.setGpuAvailable(false);

      // Invariant: Mode drops to cpu
      expect(scheduler.getMode()).toBe('cpu');
      // Invariant: GPU slot was evicted, and unshifted back into queue head
      const slots = scheduler.getSlots();
      expect(slots.gpuSlot).toBeNull();
      expect(scheduler.getQueue()[0]).toBe('job-1');
    });
  });

  // ==========================================================================
  // 3. Platform Detection & Spoofing Stress (src/utils/platform.ts)
  // ==========================================================================
  describe('3. Platform Detection Utility Spoofing & Mutation Stress', () => {
    it('detects macOS across various navigator.platform and userAgent signatures', () => {
      const macSignatures = [
        { platform: 'MacIntel', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        { platform: 'MacPPC', ua: 'Mozilla/5.0 (Macintosh; PPC Mac OS X)' },
        { platform: 'Mac68K', ua: 'Mozilla/5.0 (Macintosh; 68K)' },
        { platform: 'Macintosh', ua: '' },
        { platform: '', ua: 'Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X 14_0)' },
        { platform: '', ua: 'Darwin Kernel Version 23.0.0' },
      ];

      for (const sig of macSignatures) {
        Object.defineProperty(process, 'platform', { value: 'other', configurable: true });
        Object.defineProperty(globalThis, 'navigator', {
          value: { platform: sig.platform, userAgent: sig.ua },
          configurable: true,
          writable: true,
        });

        expect(isMacOS()).toBe(true);
        expect(isWindows()).toBe(false);
        expect(isLinux()).toBe(false);
        expect(getPlatformOS()).toBe('macos');
      }
    });

    it('detects Windows across various navigator.platform and userAgent signatures', () => {
      const winSignatures = [
        { platform: 'Win32', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        { platform: 'Win64', ua: 'Mozilla/5.0 (Windows NT 11.0; WOW64)' },
        { platform: 'Windows', ua: '' },
        { platform: '', ua: 'Mozilla/5.0 (Windows NT 6.1; Win64; x64)' },
      ];

      for (const sig of winSignatures) {
        Object.defineProperty(process, 'platform', { value: 'other', configurable: true });
        Object.defineProperty(globalThis, 'navigator', {
          value: { platform: sig.platform, userAgent: sig.ua },
          configurable: true,
          writable: true,
        });

        expect(isWindows()).toBe(true);
        expect(isMacOS()).toBe(false);
        expect(isLinux()).toBe(false);
        expect(getPlatformOS()).toBe('windows');
      }
    });

    it('detects modern NavigatorUAData (userAgentData.platform)', () => {
      Object.defineProperty(process, 'platform', { value: 'other', configurable: true });

      // macOS via userAgentData
      Object.defineProperty(globalThis, 'navigator', {
        value: { userAgentData: { platform: 'macOS' }, platform: '', userAgent: '' },
        configurable: true,
        writable: true,
      });
      expect(getPlatformOS()).toBe('macos');

      // Windows via userAgentData
      Object.defineProperty(globalThis, 'navigator', {
        value: { userAgentData: { platform: 'Windows' }, platform: '', userAgent: '' },
        configurable: true,
        writable: true,
      });
      expect(getPlatformOS()).toBe('windows');

      // Linux via userAgentData
      Object.defineProperty(globalThis, 'navigator', {
        value: { userAgentData: { platform: 'Linux' }, platform: '', userAgent: '' },
        configurable: true,
        writable: true,
      });
      expect(getPlatformOS()).toBe('linux');
    });

    it('falls back to process.platform in Node / headless / non-browser environments', () => {
      // Delete navigator
      Object.defineProperty(globalThis, 'navigator', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      expect(getPlatformOS()).toBe('macos');
      expect(isMacOS()).toBe(true);

      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      expect(getPlatformOS()).toBe('windows');
      expect(isWindows()).toBe(true);

      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      expect(getPlatformOS()).toBe('linux');
      expect(isLinux()).toBe(true);

      Object.defineProperty(process, 'platform', { value: 'sunos', configurable: true });
      expect(getPlatformOS()).toBe('unknown');
    });

    it('detects Apple Silicon architecture (macOS + arm64)', () => {
      setPlatformOverride('macos', 'arm64');
      expect(isAppleSilicon()).toBe(true);
      expect(getPlatformKey()).toBe('darwin-aarch64');

      setPlatformOverride('macos', 'x64');
      expect(isAppleSilicon()).toBe(false);
      expect(getPlatformKey()).toBe('darwin-x86_64');

      setPlatformOverride('windows', 'arm64');
      expect(isAppleSilicon()).toBe(false);
      expect(getPlatformKey()).toBe('windows-x86_64');

      setPlatformOverride('linux', 'arm64');
      expect(isAppleSilicon()).toBe(false);
      expect(getPlatformKey()).toBe('linux-aarch64');
    });

    it('handles undefined navigator gracefully in pure Node environments', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      expect(() => getPlatformOS()).not.toThrow();
      expect(() => getPlatformArch()).not.toThrow();
      expect(() => isMacOS()).not.toThrow();
      expect(() => isWindows()).not.toThrow();
      expect(() => detectPlatformInfo()).not.toThrow();
    });

    it('documents failure mode: navigator = null throws TypeError in getPlatformOS and in getPlatformArch when process.arch is unset', () => {
      // In JS, typeof null === 'object' !== 'undefined'.
      // If navigator is null, getPlatformOS attempts navigator.platform and throws TypeError.
      Object.defineProperty(globalThis, 'navigator', {
        value: null,
        configurable: true,
        writable: true,
      });

      expect(() => getPlatformOS()).toThrow(TypeError);

      // getPlatformArch only reaches navigator if process is undefined or process.arch is not a string
      Object.defineProperty(process, 'arch', { value: undefined, configurable: true });
      expect(() => getPlatformArch()).toThrow(TypeError);
    });

    it('reflects dynamic mutations immediately without caching lag', () => {
      // Rapid mutations in sequence
      const sequence: Array<'macos' | 'windows' | 'linux'> = ['macos', 'windows', 'macos', 'linux', 'windows', 'macos'];
      for (const target of sequence) {
        setPlatformOverride(target);
        expect(getPlatformOS()).toBe(target);
        if (target === 'macos') expect(isMacOS()).toBe(true);
        if (target === 'windows') expect(isWindows()).toBe(true);
        if (target === 'linux') expect(isLinux()).toBe(true);
      }
    });
  });
});
