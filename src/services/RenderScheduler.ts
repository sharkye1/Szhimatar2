import { isMacOS } from '../utils/platform';

export type RenderMode = 'cpu' | 'gpu' | 'duo';
export type RenderSlot = 'cpu' | 'gpu';

interface SchedulerSlots {
  cpuSlot: string | null;
  gpuSlot: string | null;
}

interface DispatchTarget {
  jobId: string;
  slot: RenderSlot;
}

/**
 * Authoritative mode sanitization specification:
 * - On macOS, 'duo' is sanitized to 'gpu' (or 'cpu' if gpuAvailable is false).
 * - On Windows/Linux, 'duo' is preserved if gpuAvailable is true.
 * - Malformed/invalid modes fall back safely to 'cpu'.
 */
export function sanitizeRenderMode(
  mode: RenderMode | string,
  isMac?: boolean,
  gpuAvailable: boolean = false
): RenderMode {
  const validModes: RenderMode[] = ['cpu', 'gpu', 'duo'];
  const baseMode = (validModes.includes(mode as RenderMode) ? mode : 'cpu') as RenderMode;
  const macPlatform = isMac !== undefined ? isMac : (typeof isMacOS === 'function' ? isMacOS() : false);

  if (macPlatform) {
    if (baseMode === 'duo') {
      return gpuAvailable ? 'gpu' : 'cpu';
    }
    if (baseMode === 'gpu' && !gpuAvailable) {
      return 'cpu';
    }
    return baseMode;
  }

  // Windows / Linux / fallback
  if (baseMode === 'duo' && !gpuAvailable) {
    return 'cpu';
  }
  if (baseMode === 'gpu' && !gpuAvailable) {
    return 'cpu';
  }
  return baseMode;
}

/**
 * RenderScheduler manages FIFO queue and CPU/GPU slots deterministically.
 * It does not know about FFmpeg details; it only schedules job IDs to slots.
 */
export class RenderScheduler {
  private queue: string[] = [];
  private slots: SchedulerSlots = { cpuSlot: null, gpuSlot: null };
  private mode: RenderMode = 'cpu';
  private gpuAvailable = false;
  private isMac?: boolean;

  constructor(isMac?: boolean) {
    this.isMac = isMac;
  }

  /**
   * Enqueue job in FIFO order (no duplicates)
   */
  enqueue(jobId: string): void {
    if (!this.queue.includes(jobId)) {
      this.queue.push(jobId);
    }
  }

  /**
   * Remove job from queue (if pending) and from slots (if active)
   */
  remove(jobId: string): void {
    this.queue = this.queue.filter(id => id !== jobId);
    if (this.slots.cpuSlot === jobId) this.slots.cpuSlot = null;
    if (this.slots.gpuSlot === jobId) this.slots.gpuSlot = null;
  }

  /**
   * Clear completed/error jobs from queue (does not touch slots)
   */
  clear(predicate: (jobId: string) => boolean): void {
    this.queue = this.queue.filter(id => !predicate(id));
  }

  /**
   * Set render mode with optional platform override
   */
  setMode(mode: RenderMode, isMac?: boolean): void {
    const macFlag = isMac !== undefined ? isMac : this.isMac;
    if (macFlag !== undefined) {
      this.mode = sanitizeRenderMode(mode, macFlag, this.gpuAvailable);
    } else {
      this.mode = mode;
      // If GPU mode selected but not available, fallback to CPU
      if (this.mode !== 'cpu' && !this.gpuAvailable) {
        this.mode = 'cpu';
      }
    }
  }

  /**
   * Update GPU availability flag
   */
  setGpuAvailable(value: boolean): void {
    this.gpuAvailable = value;
    if (!value && this.mode !== 'cpu') {
      this.mode = 'cpu';
      // release gpu slot assignment
      if (this.slots.gpuSlot) {
        this.queue.unshift(this.slots.gpuSlot);
        this.slots.gpuSlot = null;
      }
    }
  }

  getGpuAvailable(): boolean {
    return this.gpuAvailable;
  }

  getMode(): RenderMode {
    return this.mode;
  }

  /**
   * Reset slots (used on STOP)
   */
  resetSlots(): void {
    this.slots.cpuSlot = null;
    this.slots.gpuSlot = null;
  }

  /**
   * Reset all state (slots + queue)
   */
  resetAll(): void {
    this.queue = [];
    this.resetSlots();
  }

  /**
   * Release slot after completion/error/stop
   */
  release(jobId: string): void {
    if (this.slots.cpuSlot === jobId) this.slots.cpuSlot = null;
    if (this.slots.gpuSlot === jobId) this.slots.gpuSlot = null;
  }

  /**
   * Get ordered queue snapshot
   */
  getQueue(): string[] {
    return [...this.queue];
  }

  /**
   * Get slot snapshot
   */
  getSlots(): SchedulerSlots {
    return { ...this.slots };
  }

  /**
   * Dispatch next jobs based on available slots and mode.
   * Returns list of (jobId, slot) to start. Caller must start them and
   * then call `occupy` to mark slot busy.
   */
  planNext(isPending: (jobId: string) => boolean): DispatchTarget[] {
    const dispatch: DispatchTarget[] = [];

    const takeNext = (): string | null => {
      while (this.queue.length > 0) {
        const candidate = this.queue.shift()!;
        if (isPending(candidate)) {
          return candidate;
        }
      }
      return null;
    };

    const cpuFree = this.slots.cpuSlot === null;
    const gpuFree = this.slots.gpuSlot === null;

    // Defensive check: if scheduler was initialized with isMac=true, duo is converted to gpu
    const effectiveMode = (this.isMac && this.mode === 'duo')
      ? (this.gpuAvailable ? 'gpu' : 'cpu')
      : this.mode;

    // Determine targets based on mode
    if (effectiveMode === 'cpu') {
      if (cpuFree) {
        const next = takeNext();
        if (next) dispatch.push({ jobId: next, slot: 'cpu' });
      }
    } else if (effectiveMode === 'gpu') {
      if (this.gpuAvailable && gpuFree) {
        const next = takeNext();
        if (next) dispatch.push({ jobId: next, slot: 'gpu' });
      }
    } else if (effectiveMode === 'duo') {
      // GPU gets priority over CPU in duo mode (Windows only)
      if (this.gpuAvailable && gpuFree) {
        const nextGpu = takeNext();
        if (nextGpu) dispatch.push({ jobId: nextGpu, slot: 'gpu' });
      }
      if (cpuFree) {
        const nextCpu = takeNext();
        if (nextCpu) dispatch.push({ jobId: nextCpu, slot: 'cpu' });
      }
    }

    return dispatch;
  }

  /**
   * Occupy slot after caller started a job
   */
  occupy(jobId: string, slot: RenderSlot): void {
    if (slot === 'cpu') {
      this.slots.cpuSlot = jobId;
    } else {
      this.slots.gpuSlot = jobId;
    }
  }
}

export default RenderScheduler;
