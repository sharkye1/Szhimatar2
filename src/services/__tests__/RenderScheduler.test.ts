/**
 * RenderScheduler Unit Tests
 *
 * Tests for FIFO queue, slot management, and Duo Mode scheduling
 *
 * Run with: npx vitest run src/services/__tests__/RenderScheduler.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RenderScheduler } from '../RenderScheduler';

describe('RenderScheduler', () => {
  let scheduler: RenderScheduler;

  beforeEach(() => {
    scheduler = new RenderScheduler();
  });

  // ============================================================================
  // FIFO Queue Tests
  // ============================================================================

  describe('FIFO Queue', () => {
    it('should enqueue jobs in order', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');
      scheduler.enqueue('job3');

      expect(scheduler.getQueue()).toEqual(['job1', 'job2', 'job3']);
    });

    it('should not add duplicate jobs', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');

      expect(scheduler.getQueue()).toEqual(['job1', 'job2']);
    });

    it('should remove job from queue', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');
      scheduler.enqueue('job3');

      scheduler.remove('job2');

      expect(scheduler.getQueue()).toEqual(['job1', 'job3']);
    });

    it('should clear jobs matching predicate', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');
      scheduler.enqueue('job3');

      // Clear job2
      scheduler.clear((id) => id === 'job2');

      expect(scheduler.getQueue()).toEqual(['job1', 'job3']);
    });

    it('should reset all state', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');
      scheduler.setGpuAvailable(true);
      scheduler.setMode('duo');
      scheduler.occupy('job1', 'cpu');

      scheduler.resetAll();

      expect(scheduler.getQueue()).toEqual([]);
      expect(scheduler.getSlots()).toEqual({ cpuSlot: null, gpuSlot: null });
    });
  });

  // ============================================================================
  // CPU Mode Tests
  // ============================================================================

  describe('CPU Mode', () => {
    it('should default to CPU mode', () => {
      expect(scheduler.getMode()).toBe('cpu');
    });

    it('should dispatch to CPU slot only in CPU mode', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');

      const isPending = () => true;
      const dispatch = scheduler.planNext(isPending);

      expect(dispatch).toHaveLength(1);
      expect(dispatch[0]).toEqual({ jobId: 'job1', slot: 'cpu' });
    });

    it('should not dispatch if CPU slot is occupied', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');

      scheduler.occupy('job1', 'cpu');

      const isPending = () => true;
      const dispatch = scheduler.planNext(isPending);

      expect(dispatch).toHaveLength(0);
    });

    it('should dispatch next job after slot is released', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');

      // Dispatch job1
      scheduler.planNext(() => true);
      scheduler.occupy('job1', 'cpu');

      // Release job1
      scheduler.release('job1');

      // Should now dispatch job2
      const dispatch = scheduler.planNext(() => true);
      expect(dispatch).toHaveLength(1);
      expect(dispatch[0]).toEqual({ jobId: 'job2', slot: 'cpu' });
    });
  });

  // ============================================================================
  // GPU Mode Tests
  // ============================================================================

  describe('GPU Mode', () => {
    beforeEach(() => {
      scheduler.setGpuAvailable(true);
      scheduler.setMode('gpu');
    });

    it('should dispatch to GPU slot in GPU mode', () => {
      scheduler.enqueue('job1');

      const dispatch = scheduler.planNext(() => true);

      expect(dispatch).toHaveLength(1);
      expect(dispatch[0]).toEqual({ jobId: 'job1', slot: 'gpu' });
    });

    it('should fallback to CPU mode if GPU unavailable', () => {
      scheduler.setGpuAvailable(false);

      expect(scheduler.getMode()).toBe('cpu');
    });

    it('should not dispatch if GPU slot is occupied', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');

      scheduler.occupy('job1', 'gpu');

      const dispatch = scheduler.planNext(() => true);

      expect(dispatch).toHaveLength(0);
    });

    it('should move GPU job back to queue when GPU becomes unavailable', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');

      // Dispatch job1 to GPU (this removes it from queue)
      const dispatch = scheduler.planNext(() => true);
      expect(dispatch[0]).toEqual({ jobId: 'job1', slot: 'gpu' });

      // Occupy GPU slot
      scheduler.occupy('job1', 'gpu');

      // Queue should only have job2 now
      expect(scheduler.getQueue()).toEqual(['job2']);

      // GPU becomes unavailable
      scheduler.setGpuAvailable(false);

      // job1 should be back in queue at front
      expect(scheduler.getQueue()).toEqual(['job1', 'job2']);
      expect(scheduler.getSlots().gpuSlot).toBeNull();
    });
  });

  // ============================================================================
  // Duo Mode Tests
  // ============================================================================

  describe('Duo Mode', () => {
    beforeEach(() => {
      scheduler.setGpuAvailable(true);
      scheduler.setMode('duo');
    });

it('should dispatch to both slots in Duo mode (GPU priority)', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');

      const dispatch = scheduler.planNext(() => true);

      expect(dispatch).toHaveLength(2);
      expect(dispatch[0]).toEqual({ jobId: 'job1', slot: 'gpu' });
      expect(dispatch[1]).toEqual({ jobId: 'job2', slot: 'cpu' });
    });

    it('should dispatch only to GPU if only one job available in Duo mode', () => {
      scheduler.enqueue('job1');

      const dispatch = scheduler.planNext(() => true);

      // Should dispatch to GPU first
      expect(dispatch).toHaveLength(1);
      expect(dispatch[0]).toEqual({ jobId: 'job1', slot: 'gpu' });
    });

    it('should dispatch to free slot when one is occupied', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');
      scheduler.enqueue('job3');

      // Occupy CPU slot
      scheduler.occupy('job1', 'cpu');

      // Remove job1 from queue (already dispatched)
      scheduler.planNext(() => true); // This removes job2 from queue
      scheduler.occupy('job2', 'gpu');

      // Now both slots are occupied
      const dispatch = scheduler.planNext(() => true);
      expect(dispatch).toHaveLength(0);
    });

    it('should handle interleaved completions correctly', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');
      scheduler.enqueue('job3');
      scheduler.enqueue('job4');

      // Dispatch first pair
      let dispatch = scheduler.planNext(() => true);
      expect(dispatch).toHaveLength(2);
      scheduler.occupy(dispatch[0].jobId, dispatch[0].slot);
      scheduler.occupy(dispatch[1].jobId, dispatch[1].slot);

      // GPU (job1) completes first (remember GPU gets priority on dispatch, so dispatch[0] is gpu)
      scheduler.release('job1');

      // Should dispatch job3 to GPU
      dispatch = scheduler.planNext(() => true);
      expect(dispatch).toHaveLength(1);
      expect(dispatch[0]).toEqual({ jobId: 'job3', slot: 'gpu' });
      scheduler.occupy('job3', 'gpu');

      // CPU (job2) completes
      scheduler.release('job2');

      // Should dispatch job4 to CPU
      dispatch = scheduler.planNext(() => true);
      expect(dispatch).toHaveLength(1);
      expect(dispatch[0]).toEqual({ jobId: 'job4', slot: 'cpu' });
    });

    it('should fallback to CPU-only when GPU unavailable in Duo mode', () => {
      scheduler.setGpuAvailable(false);

      // Mode should fallback to CPU
      expect(scheduler.getMode()).toBe('cpu');
    });

    it('should continue CPU renders when GPU render fails', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');
      scheduler.enqueue('job3');

      // Dispatch to both slots
      const initialDispatch = scheduler.planNext(() => true);
      scheduler.occupy(initialDispatch[0].jobId, initialDispatch[0].slot); // job1 -> GPU
      scheduler.occupy(initialDispatch[1].jobId, initialDispatch[1].slot); // job2 -> CPU

      // GPU render fails - release slot
      scheduler.release('job1');

      // CPU should still be occupied
      expect(scheduler.getSlots().cpuSlot).toBe('job2');
      expect(scheduler.getSlots().gpuSlot).toBeNull();

      const nextDispatch = scheduler.planNext(() => true);
      expect(nextDispatch).toHaveLength(1);
      expect(nextDispatch[0]).toEqual({ jobId: 'job3', slot: 'gpu' });
    });
  });

  // ============================================================================
  // Mode Switching Tests
  // ============================================================================

  describe('Mode Switching', () => {
    it('should switch from CPU to GPU mode', () => {
      scheduler.setGpuAvailable(true);
      expect(scheduler.getMode()).toBe('cpu');

      scheduler.setMode('gpu');
      expect(scheduler.getMode()).toBe('gpu');
    });

    it('should switch from GPU to Duo mode', () => {
      scheduler.setGpuAvailable(true);
      scheduler.setMode('gpu');

      scheduler.setMode('duo');
      expect(scheduler.getMode()).toBe('duo');
    });

    it('should switch from Duo to CPU mode', () => {
      scheduler.setGpuAvailable(true);
      scheduler.setMode('duo');

      scheduler.setMode('cpu');
      expect(scheduler.getMode()).toBe('cpu');
    });

    it('should not allow GPU/Duo mode without GPU available', () => {
      scheduler.setGpuAvailable(false);

      scheduler.setMode('gpu');
      expect(scheduler.getMode()).toBe('cpu');

      scheduler.setMode('duo');
      expect(scheduler.getMode()).toBe('cpu');
    });

    it('should preserve pending jobs when switching modes', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');
      scheduler.enqueue('job3');

      scheduler.setGpuAvailable(true);
      scheduler.setMode('duo');

      // Jobs should still be in queue
      expect(scheduler.getQueue()).toEqual(['job1', 'job2', 'job3']);
    });
  });

  // ============================================================================
  // Slot Management Tests
  // ============================================================================

  describe('Slot Management', () => {
    it('should occupy CPU slot', () => {
      scheduler.occupy('job1', 'cpu');

      expect(scheduler.getSlots().cpuSlot).toBe('job1');
      expect(scheduler.getSlots().gpuSlot).toBeNull();
    });

    it('should occupy GPU slot', () => {
      scheduler.occupy('job1', 'gpu');

      expect(scheduler.getSlots().cpuSlot).toBeNull();
      expect(scheduler.getSlots().gpuSlot).toBe('job1');
    });

    it('should release CPU slot', () => {
      scheduler.occupy('job1', 'cpu');
      scheduler.release('job1');

      expect(scheduler.getSlots().cpuSlot).toBeNull();
    });

    it('should release GPU slot', () => {
      scheduler.occupy('job1', 'gpu');
      scheduler.release('job1');

      expect(scheduler.getSlots().gpuSlot).toBeNull();
    });

    it('should reset both slots', () => {
      scheduler.occupy('job1', 'cpu');
      scheduler.occupy('job2', 'gpu');

      scheduler.resetSlots();

      expect(scheduler.getSlots()).toEqual({ cpuSlot: null, gpuSlot: null });
    });

    it('should remove job from both queue and slot', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');
      scheduler.occupy('job1', 'cpu');

      scheduler.remove('job1');

      expect(scheduler.getQueue()).toEqual(['job2']);
      expect(scheduler.getSlots().cpuSlot).toBeNull();
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle empty queue gracefully', () => {
      const dispatch = scheduler.planNext(() => true);

      expect(dispatch).toHaveLength(0);
    });

    it('should skip non-pending jobs in planNext', () => {
      scheduler.enqueue('job1');
      scheduler.enqueue('job2');
      scheduler.enqueue('job3');

      // Only job2 is pending
      const isPending = (id: string) => id === 'job2';
      const dispatch = scheduler.planNext(isPending);

      expect(dispatch).toHaveLength(1);
      expect(dispatch[0]).toEqual({ jobId: 'job2', slot: 'cpu' });
    });

    it('should handle rapid mode switching', () => {
      scheduler.setGpuAvailable(true);

      scheduler.setMode('cpu');
      scheduler.setMode('gpu');
      scheduler.setMode('duo');
      scheduler.setMode('cpu');
      scheduler.setMode('duo');

      expect(scheduler.getMode()).toBe('duo');
    });

    it('should handle job removal that is not in queue', () => {
      scheduler.enqueue('job1');

      // Should not throw
      scheduler.remove('nonexistent');

      expect(scheduler.getQueue()).toEqual(['job1']);
    });

    it('should handle release of non-occupied job', () => {
      scheduler.occupy('job1', 'cpu');

      // Should not throw and should not affect job1
      scheduler.release('nonexistent');

      expect(scheduler.getSlots().cpuSlot).toBe('job1');
    });
  });
});
