/**
 * useRenderQueue - React hook for managing render queue
 * 
 * Usage:
 * ```tsx
 * const {
 *   jobs,
 *   isProcessing,
 *   isPaused,
 *   addFiles,
 *   start,
 *   pause,
 *   resume,
 *   stop,
 *   removeJob,
 *   clearCompleted,
 * } = useRenderQueue();
 * ```
 */

import { useState, useEffect, useCallback } from 'react';
import RenderService, { RenderJob, RenderQueueState } from '../services/RenderService';
import type { VideoSettings, AudioSettings, WatermarkSettings, MainScreenSettings } from '../types';

export interface UseRenderQueueReturn {
  // State
  jobs: RenderJob[];
  isProcessing: boolean;
  isPaused: boolean;
  currentJobId: string | null;
  renderMode: 'cpu' | 'gpu' | 'duo';
  gpuAvailable: boolean;
  
  // Statistics
  totalJobs: number;
  completedJobs: number;
  errorJobs: number;
  pendingJobs: number;
  
  // Actions
  addFiles: (filePaths: string[]) => Promise<RenderJob[]>;
  addToQueue: (inputPath: string, outputPath: string) => Promise<RenderJob>;
  removeJob: (jobId: string) => boolean;
  clearCompleted: () => void;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  stopJob: (jobId: string) => Promise<boolean>;
  
  // Settings
  updateSettings: (
    video: VideoSettings,
    audio: AudioSettings,
    watermark?: WatermarkSettings,
    mainScreen?: MainScreenSettings,
    outputSuffix?: string,
    presetName?: string,
  ) => void;
  setRenderMode: (mode: 'cpu' | 'gpu' | 'duo') => void;
  setGpuAvailability: (available: boolean) => void;
}

export function useRenderQueue(): UseRenderQueueReturn {
  const [state, setState] = useState<RenderQueueState>(() => RenderService.getState());

  // Subscribe to RenderService updates
  useEffect(() => {
    const unsubscribe = RenderService.subscribe((jobs) => {
      setState({
        ...RenderService.getState(),
        jobs,
      });
    });

    // Initial state
    setState(RenderService.getState());

    return () => {
      unsubscribe();
    };
  }, []);

  // Computed statistics
  const totalJobs = state.jobs.length;
  const completedJobs = state.jobs.filter(j => j.status === 'completed').length;
  const errorJobs = state.jobs.filter(j => j.status === 'error').length;
  const pendingJobs = state.jobs.filter(j => j.status === 'pending').length;

  // Actions
  const addFiles = useCallback(async (filePaths: string[]): Promise<RenderJob[]> => {
    return RenderService.addToQueue(filePaths);
  }, []);

  const addToQueue = useCallback(async (inputPath: string, outputPath: string): Promise<RenderJob> => {
    return (RenderService as any).addToQueueWithOutput(inputPath, outputPath);
  }, []);

  const removeJob = useCallback((jobId: string): boolean => {
    return RenderService.removeFromQueue(jobId);
  }, []);

  const clearCompleted = useCallback((): void => {
    RenderService.clearCompleted();
  }, []);

  const start = useCallback(async (): Promise<void> => {
    await RenderService.start();
  }, []);

  const pause = useCallback((): void => {
    RenderService.pause();
  }, []);

  const resume = useCallback(async (): Promise<void> => {
    await RenderService.resume();
  }, []);

  const stop = useCallback(async (): Promise<void> => {
    await RenderService.stop();
  }, []);

  const stopJob = useCallback(async (jobId: string): Promise<boolean> => {
    return RenderService.stopJob(jobId);
  }, []);

  const updateSettings = useCallback((
    video: VideoSettings,
    audio: AudioSettings,
    watermark?: WatermarkSettings,
    mainScreen?: MainScreenSettings,
    outputSuffix?: string,
    presetName?: string,
  ): void => {
    RenderService.updateSettings(video, audio, watermark, mainScreen, outputSuffix, presetName);
  }, []);

  const setRenderMode = useCallback((mode: 'cpu' | 'gpu' | 'duo'): void => {
    (RenderService as any).setRenderMode(mode);
  }, []);

  const setGpuAvailability = useCallback((available: boolean): void => {
    (RenderService as any).setGpuAvailability(available);
  }, []);

  return {
    // State
    jobs: state.jobs,
    isProcessing: state.isProcessing,
    isPaused: state.isPaused,
    currentJobId: state.currentJobId,
    renderMode: state.renderMode,
    gpuAvailable: state.gpuAvailable,
    
    // Statistics
    totalJobs,
    completedJobs,
    errorJobs,
    pendingJobs,
    
    // Actions
    addFiles,
    addToQueue,
    removeJob,
    clearCompleted,
    start,
    pause,
    resume,
    stop,
    stopJob,
    
    // Settings
    updateSettings,
    setRenderMode,
    setGpuAvailability,
  };
}

export default useRenderQueue;
