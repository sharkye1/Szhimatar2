import { describe, it, expect } from 'vitest';
import RenderService, { RenderJob } from '../../src/services/RenderService';

describe('RenderService Completion and Status Immutability', () => {
  it('creates new object references on completion to ensure React.memo detects state changes', () => {
    // Access private jobs Map for testing
    const jobsMap = (RenderService as any).jobs as Map<string, RenderJob>;
    
    const jobId = 'test-job-completion-1';
    const initialJob: RenderJob = {
      id: jobId,
      inputPath: 'C:/Videos/sample.mp4',
      outputPath: 'C:/Videos/sample_compressed.mp4',
      fileName: 'sample.mp4',
      status: 'processing',
      progress: 99.7,
      fps: 300,
      speed: 10,
      bitrate: '5000k',
      eta: 0,
      etaFormatted: '00:00:00',
      currentTime: 10,
      frame: 600,
      inputSize: '10 MB',
      inputSizeBytes: 10485760,
      outputSize: '8.1 MB',
      outputSizeBytes: 8500000,
      durationSeconds: 10,
      trimStartSec: 0,
      trimEndSec: 10,
    };

    jobsMap.set(jobId, initialJob);

    // Call private handleJobComplete
    (RenderService as any).handleJobComplete(jobId);

    const completedJob = jobsMap.get(jobId);
    expect(completedJob).toBeDefined();

    // Verify object reference was replaced (immutability for React.memo)
    expect(completedJob).not.toBe(initialJob);

    // Verify terminal values
    expect(completedJob!.status).toBe('completed');
    expect(completedJob!.progress).toBe(100);
    expect(completedJob!.eta).toBe(0);
    expect(completedJob!.etaFormatted).toBe('00:00:00');

    // Clean up
    jobsMap.delete(jobId);
  });

  it('notifies high-frequency jobProgressListeners with 100% progress upon completion', () => {
    const jobsMap = (RenderService as any).jobs as Map<string, RenderJob>;
    const jobId = 'test-job-progress-listener-1';

    const initialJob: RenderJob = {
      id: jobId,
      inputPath: 'C:/Videos/sample.mp4',
      outputPath: 'C:/Videos/sample_compressed.mp4',
      fileName: 'sample.mp4',
      status: 'processing',
      progress: 99.8,
      fps: 250,
      speed: 8,
      bitrate: '4000k',
      eta: 0,
      etaFormatted: '00:00:00',
      currentTime: 20,
      frame: 1200,
      inputSize: '20 MB',
      inputSizeBytes: 20971520,
      outputSize: '9.4 MB',
      outputSizeBytes: 9800000,
      durationSeconds: 20,
      trimStartSec: 0,
      trimEndSec: 20,
    };

    jobsMap.set(jobId, initialJob);

    let receivedProgress: any = null;
    const unsubscribe = RenderService.subscribeJobProgress(jobId, (data) => {
      receivedProgress = data;
    });

    // Complete the job
    (RenderService as any).handleJobComplete(jobId);

    expect(receivedProgress).toBeDefined();
    expect(receivedProgress.progress).toBe(100);
    expect(receivedProgress.fps).toBe(0);
    expect(receivedProgress.speed).toBe(0);
    expect(receivedProgress.etaFormatted).toBe('00:00:00');

    unsubscribe();
    jobsMap.delete(jobId);
  });

  it('prevents stale throttled progress from overriding completed status in flushProgressUpdates', () => {
    const jobsMap = (RenderService as any).jobs as Map<string, RenderJob>;
    const jobId = 'test-job-stale-progress-1';

    const completedJob: RenderJob = {
      id: jobId,
      inputPath: 'C:/Videos/sample.mp4',
      outputPath: 'C:/Videos/sample_compressed.mp4',
      fileName: 'sample.mp4',
      status: 'completed',
      progress: 100,
      fps: 0,
      speed: 0,
      bitrate: '5000k',
      eta: 0,
      etaFormatted: '00:00:00',
      currentTime: 10,
      frame: 600,
      inputSize: '10 MB',
      inputSizeBytes: 10485760,
      outputSize: '8.1 MB',
      outputSizeBytes: 8500000,
      durationSeconds: 10,
      trimStartSec: 0,
      trimEndSec: 10,
    };

    jobsMap.set(jobId, completedJob);

    // Simulate an old progress packet trapped in pendingJobProgress
    (RenderService as any).pendingJobProgress.set(jobId, {
      jobId,
      progress: 99.7,
      fps: 300,
      speed: 10,
      bitrate: '5000k',
      eta: 0,
      etaFormatted: '00:00:00',
      currentTime: 9.9,
      frame: 598,
      outputSize: '8.1 MB',
    });

    let progressCallbackFired = false;
    const unsubscribe = RenderService.subscribeJobProgress(jobId, () => {
      progressCallbackFired = true;
    });
    // Reset flag after initial snapshot
    progressCallbackFired = false;

    // Flush
    (RenderService as any).flushProgressUpdates();

    // Verify listener was NOT called with the stale 99.7% progress
    expect(progressCallbackFired).toBe(false);

    unsubscribe();
    jobsMap.delete(jobId);
  });
});
