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
 * RenderScheduler manages FIFO queue and CPU/GPU slots deterministically.
 * It does not know about FFmpeg details; it only schedules job IDs to slots.
 */
export class RenderScheduler {
  private queue: string[] = [];
  private slots: SchedulerSlots = { cpuSlot: null, gpuSlot: null };
  private mode: RenderMode = 'cpu';
  private gpuAvailable = false;

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
   * Set render mode
   */
  setMode(mode: RenderMode): void {
    this.mode = mode;
    // If GPU mode selected but not available, fallback to CPU
    if (this.mode !== 'cpu' && !this.gpuAvailable) {
      this.mode = 'cpu';
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

    // Determine targets based on mode
    if (this.mode === 'cpu') {
      if (cpuFree) {
        const next = takeNext();
        if (next) dispatch.push({ jobId: next, slot: 'cpu' });
      }
    } else if (this.mode === 'gpu') {
      if (this.gpuAvailable && gpuFree) {
        const next = takeNext();
        if (next) dispatch.push({ jobId: next, slot: 'gpu' });
      }
    } else if (this.mode === 'duo') {
      if (cpuFree) {
        const nextCpu = takeNext();
        if (nextCpu) dispatch.push({ jobId: nextCpu, slot: 'cpu' });
      }
      if (this.gpuAvailable && gpuFree) {
        const nextGpu = takeNext();
        if (nextGpu) dispatch.push({ jobId: nextGpu, slot: 'gpu' });
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
