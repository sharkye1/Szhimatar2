/**
 * StatisticsService - Manages render statistics and history
 * 
 * Features:
 * - Track all renders with status, progress, timing
 * - Persist to stats/stat.json via Tauri
 * - Export/import functionality
 * - Aggregate statistics (total renders, success rate, etc.)
 */

import { invoke } from '@tauri-apps/api/tauri';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import type { RenderProgress } from './RenderService';

// ============================================================================
// Types
// ============================================================================

export type RenderStatus = 'pending' | 'rendering' | 'completed' | 'error' | 'cancelled';

export interface VideoStatsSettings {
  codec: string;
  bitrate: string;
  fps: string;
  resolution: string;
  crf: string;
  preset: string;
}

export interface AudioStatsSettings {
  codec: string;
  bitrate: string;
  channels: string;
  sampleRate: string;
}

export interface RenderStatRecord {
  id: string;
  fileName: string;
  inputPath: string;
  outputFile: string;
  outputPath: string;
  preset: string;
  video: VideoStatsSettings;
  audio: AudioStatsSettings;
  status: RenderStatus;
  progress: number;
  duration: number;         // Video duration in seconds
  renderTime: number;       // Time taken to render in seconds
  fpsAchieved: number;      // Average FPS during render
  bitrateAchieved: string;  // Final bitrate
  speed: number;            // Render speed multiplier
  eta: number;              // ETA in seconds (during render)
  etaFormatted: string;     // ETA formatted string
  error?: string;           // Error message if failed
  createdAt: string;        // ISO timestamp
  completedAt?: string;     // ISO timestamp when completed
}

export interface Statistics {
  renders: RenderStatRecord[];
  totalRenders: number;
  totalSuccessful: number;
  totalFailed: number;
  totalRenderTime: number;  // Total seconds spent rendering
  lastUpdated: string;      // ISO timestamp
}

export type StatisticsEventCallback = (stats: Statistics) => void;

// ============================================================================
// Statistics Service (Singleton)
// ============================================================================

class StatisticsServiceImpl {
  private stats: Statistics = {
    renders: [],
    totalRenders: 0,
    totalSuccessful: 0,
    totalFailed: 0,
    totalRenderTime: 0,
    lastUpdated: new Date().toISOString(),
  };
  private loaded: boolean = false;
  private listeners: Set<StatisticsEventCallback> = new Set();
  private unlistenProgress: UnlistenFn | null = null;
  private unlistenComplete: UnlistenFn | null = null;
  private unlistenError: UnlistenFn | null = null;
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.setupEventListeners();
  }

  /**
   * Setup Tauri event listeners for automatic tracking
   */
  private async setupEventListeners(): Promise<void> {
    try {
      // Listen for progress updates
      this.unlistenProgress = await listen<RenderProgress>('render-progress', (event) => {
        this.updateRenderProgress(event.payload.job_id, {
          progress: event.payload.progress_percent,
          fps: event.payload.fps,
          speed: event.payload.speed,
          bitrate: event.payload.bitrate,
          eta: event.payload.eta_seconds,
        });
      });

      // Listen for completion
      this.unlistenComplete = await listen<string>('render-complete', (event) => {
        this.markRenderComplete(event.payload);
      });

      // Listen for errors
      this.unlistenError = await listen<{ job_id: string; error: string }>('render-error', (event) => {
        this.markRenderError(event.payload.job_id, event.payload.error);
      });
    } catch (error) {
      console.error('[StatisticsService] Failed to setup event listeners:', error);
    }
  }

  /**
   * Cleanup event listeners
   */
  public async cleanup(): Promise<void> {
    if (this.unlistenProgress) this.unlistenProgress();
    if (this.unlistenComplete) this.unlistenComplete();
    if (this.unlistenError) this.unlistenError();
    
    // Save before cleanup
    await this.save();
  }

  /**
   * Subscribe to statistics updates
   */
  public subscribe(callback: StatisticsEventCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(): void {
    this.listeners.forEach(callback => callback(this.stats));
  }

  /**
   * Load statistics from file
   */
  public async load(): Promise<Statistics> {
    try {
      const jsonStr = await invoke<string>('load_statistics');
      this.stats = JSON.parse(jsonStr);
      this.loaded = true;
      console.log('[StatisticsService] Loaded statistics:', this.stats.renders.length, 'renders');
      this.notifyListeners();
      return this.stats;
    } catch (error) {
      console.error('[StatisticsService] Failed to load statistics:', error);
      // Return default empty stats
      this.stats = {
        renders: [],
        totalRenders: 0,
        totalSuccessful: 0,
        totalFailed: 0,
        totalRenderTime: 0,
        lastUpdated: new Date().toISOString(),
      };
      this.loaded = true;
      return this.stats;
    }
  }

  /**
   * Save statistics to file (debounced)
   */
  public async save(): Promise<void> {
    // Cancel pending save
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    // Debounce save to avoid too many writes
    this.saveDebounceTimer = setTimeout(async () => {
      try {
        this.stats.lastUpdated = new Date().toISOString();
        const jsonStr = JSON.stringify(this.stats, null, 2);
        await invoke('save_statistics', { content: jsonStr });
        console.log('[StatisticsService] Statistics saved');
      } catch (error) {
        console.error('[StatisticsService] Failed to save statistics:', error);
      }
    }, 500);
  }

  /**
   * Force immediate save
   */
  public async saveImmediate(): Promise<void> {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    
    try {
      this.stats.lastUpdated = new Date().toISOString();
      const jsonStr = JSON.stringify(this.stats, null, 2);
      await invoke('save_statistics', { content: jsonStr });
      console.log('[StatisticsService] Statistics saved (immediate)');
    } catch (error) {
      console.error('[StatisticsService] Failed to save statistics:', error);
    }
  }

  /**
   * Add a new render record when render starts
   */
  public addRender(info: {
    id: string;
    fileName: string;
    inputPath: string;
    outputPath: string;
    preset: string;
    video: VideoStatsSettings;
    audio: AudioStatsSettings;
    duration: number;
  }): RenderStatRecord {
    const record: RenderStatRecord = {
      id: info.id,
      fileName: info.fileName,
      inputPath: info.inputPath,
      outputFile: info.outputPath.split(/[\\/]/).pop() || info.outputPath,
      outputPath: info.outputPath,
      preset: info.preset,
      video: info.video,
      audio: info.audio,
      status: 'rendering',
      progress: 0,
      duration: info.duration,
      renderTime: 0,
      fpsAchieved: 0,
      bitrateAchieved: '',
      speed: 0,
      eta: 0,
      etaFormatted: '--:--:--',
      createdAt: new Date().toISOString(),
    };

    // Add to beginning of list (newest first)
    this.stats.renders.unshift(record);
    this.stats.totalRenders++;
    
    // Keep only last 100 renders to avoid bloat
    if (this.stats.renders.length > 100) {
      this.stats.renders = this.stats.renders.slice(0, 100);
    }

    this.notifyListeners();
    this.save();

    return record;
  }

  /**
   * Update render progress
   */
  public updateRenderProgress(id: string, progressInfo: {
    progress: number;
    fps?: number;
    speed?: number;
    bitrate?: string;
    eta?: number;
  }): void {
    const record = this.stats.renders.find(r => r.id === id);
    if (!record || record.status !== 'rendering') return;

    record.progress = Math.min(100, progressInfo.progress);
    
    if (progressInfo.fps !== undefined) {
      record.fpsAchieved = progressInfo.fps;
    }
    if (progressInfo.speed !== undefined) {
      record.speed = progressInfo.speed;
    }
    if (progressInfo.bitrate !== undefined) {
      record.bitrateAchieved = progressInfo.bitrate;
    }
    if (progressInfo.eta !== undefined) {
      record.eta = progressInfo.eta;
      record.etaFormatted = this.formatETA(progressInfo.eta);
    }

    // Calculate render time so far
    const startTime = new Date(record.createdAt).getTime();
    record.renderTime = (Date.now() - startTime) / 1000;

    this.notifyListeners();
    // Don't save on every progress update to reduce disk writes
  }

  /**
   * Mark render as completed
   */
  public markRenderComplete(id: string): void {
    const record = this.stats.renders.find(r => r.id === id);
    if (!record) return;

    record.status = 'completed';
    record.progress = 100;
    record.eta = 0;
    record.etaFormatted = '00:00:00';
    record.completedAt = new Date().toISOString();
    
    // Calculate final render time
    const startTime = new Date(record.createdAt).getTime();
    record.renderTime = (Date.now() - startTime) / 1000;

    this.stats.totalSuccessful++;
    this.stats.totalRenderTime += record.renderTime;

    console.log('[StatisticsService] Render completed:', id, `${record.renderTime.toFixed(1)}s`);

    this.notifyListeners();
    this.saveImmediate();
  }

  /**
   * Mark render as error
   */
  public markRenderError(id: string, error: string): void {
    const record = this.stats.renders.find(r => r.id === id);
    if (!record) return;

    record.status = 'error';
    record.error = error;
    record.completedAt = new Date().toISOString();
    
    // Calculate render time until error
    const startTime = new Date(record.createdAt).getTime();
    record.renderTime = (Date.now() - startTime) / 1000;

    this.stats.totalFailed++;

    console.log('[StatisticsService] Render error:', id, error);

    this.notifyListeners();
    this.saveImmediate();
  }

  /**
   * Mark render as cancelled
   */
  public markRenderCancelled(id: string): void {
    const record = this.stats.renders.find(r => r.id === id);
    if (!record) return;

    record.status = 'cancelled';
    record.completedAt = new Date().toISOString();
    
    const startTime = new Date(record.createdAt).getTime();
    record.renderTime = (Date.now() - startTime) / 1000;

    this.notifyListeners();
    this.save();
  }

  /**
   * Format ETA as HH:MM:SS
   */
  private formatETA(seconds: number): string {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) {
      return '--:--:--';
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Format duration as human-readable
   */
  public formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '0s';

    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}m ${secs}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${mins}m`;
    }
  }

  /**
   * Get current statistics
   */
  public getStats(): Statistics {
    return this.stats;
  }

  /**
   * Get all renders
   */
  public getRenders(): RenderStatRecord[] {
    return this.stats.renders;
  }

  /**
   * Get active renders (currently rendering)
   */
  public getActiveRenders(): RenderStatRecord[] {
    return this.stats.renders.filter(r => r.status === 'rendering');
  }

  /**
   * Get aggregate statistics
   */
  public getAggregateStats(): {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
    avgRenderTime: number;
    avgSpeed: number;
    totalTime: number;
  } {
    const successful = this.stats.totalSuccessful;
    const total = this.stats.totalRenders;
    const completed = this.stats.renders.filter(r => r.status === 'completed');
    
    const avgRenderTime = completed.length > 0
      ? completed.reduce((sum, r) => sum + r.renderTime, 0) / completed.length
      : 0;
    
    const avgSpeed = completed.length > 0
      ? completed.reduce((sum, r) => sum + r.speed, 0) / completed.length
      : 0;

    return {
      total,
      successful,
      failed: this.stats.totalFailed,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      avgRenderTime,
      avgSpeed,
      totalTime: this.stats.totalRenderTime,
    };
  }

  /**
   * Clear all statistics
   */
  public async clearHistory(): Promise<void> {
    try {
      await invoke('clear_statistics');
      this.stats = {
        renders: [],
        totalRenders: 0,
        totalSuccessful: 0,
        totalFailed: 0,
        totalRenderTime: 0,
        lastUpdated: new Date().toISOString(),
      };
      this.notifyListeners();
      console.log('[StatisticsService] History cleared');
    } catch (error) {
      console.error('[StatisticsService] Failed to clear history:', error);
      throw error;
    }
  }

  /**
   * Export statistics to file
   */
  public async exportToFile(outputPath: string): Promise<void> {
    try {
      await invoke('export_statistics', { outputPath });
      console.log('[StatisticsService] Exported to:', outputPath);
    } catch (error) {
      console.error('[StatisticsService] Failed to export:', error);
      throw error;
    }
  }

  /**
   * Delete a specific render record
   */
  public deleteRender(id: string): void {
    const index = this.stats.renders.findIndex(r => r.id === id);
    if (index === -1) return;

    const record = this.stats.renders[index];
    
    // Update counters
    if (record.status === 'completed') {
      this.stats.totalSuccessful--;
      this.stats.totalRenderTime -= record.renderTime;
    } else if (record.status === 'error') {
      this.stats.totalFailed--;
    }
    this.stats.totalRenders--;

    this.stats.renders.splice(index, 1);
    this.notifyListeners();
    this.save();
  }

  /**
   * Check if loaded
   */
  public isLoaded(): boolean {
    return this.loaded;
  }
}

// Export singleton instance
export const StatisticsService = new StatisticsServiceImpl();
export default StatisticsService;
