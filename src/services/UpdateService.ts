/**
 * UpdateService - Tauri Updater integration
 * 
 * Provides auto-update functionality using Tauri's built-in updater.
 * Uses GitHub Releases as the update source.
 */

import { checkUpdate, installUpdate, onUpdaterEvent } from '@tauri-apps/api/updater';
import { relaunch } from '@tauri-apps/api/process';

export type UpdateStatus = 
  | 'idle'
  | 'checking'
  | 'update-available'
  | 'downloading'
  | 'installing'
  | 'up-to-date'
  | 'error';

export interface UpdateInfo {
  currentVersion: string;
  newVersion: string;
  releaseNotes?: string;
  releaseDate?: string;
}

export interface UpdateProgress {
  downloaded: number;
  total: number;
  percent: number;
}

export interface UpdateState {
  status: UpdateStatus;
  info: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
}

type UpdateListener = (state: UpdateState) => void;

class UpdateServiceClass {
  private state: UpdateState = {
    status: 'idle',
    info: null,
    progress: null,
    error: null,
  };

  private listeners: Set<UpdateListener> = new Set();
  private unlistenUpdaterEvent: (() => void) | null = null;
  private isInitialized = false;

  /**
   * Initialize the update service and set up event listeners
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Listen for updater events
      this.unlistenUpdaterEvent = await onUpdaterEvent(({ error, status }) => {
        console.log('[UpdateService] Updater event:', status, error);

        if (error) {
          this.updateState({
            status: 'error',
            error: this.formatError(error),
          });
          return;
        }

        switch (status) {
          case 'PENDING':
            this.updateState({ status: 'downloading' });
            break;
          case 'DONE':
            this.updateState({ status: 'installing' });
            break;
          case 'UPTODATE':
            this.updateState({ status: 'up-to-date' });
            break;
          case 'ERROR':
            this.updateState({
              status: 'error',
              error: error || 'Unknown error during update',
            });
            break;
        }
      });

      this.isInitialized = true;
      console.log('[UpdateService] Initialized');
    } catch (error) {
      console.error('[UpdateService] Failed to initialize:', error);
      // Don't crash the app if updater fails to initialize
    }
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    if (this.unlistenUpdaterEvent) {
      this.unlistenUpdaterEvent();
      this.unlistenUpdaterEvent = null;
    }
    this.listeners.clear();
    this.isInitialized = false;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    // Immediately call with current state
    listener(this.state);
    
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Get current state
   */
  getState(): UpdateState {
    return { ...this.state };
  }

  /**
   * Check for available updates
   * Safe to call - won't crash on network errors
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    if (this.state.status === 'checking' || this.state.status === 'downloading') {
      console.log('[UpdateService] Already checking or downloading');
      return this.state.info;
    }

    this.updateState({
      status: 'checking',
      error: null,
    });

    try {
      const { shouldUpdate, manifest } = await checkUpdate();

      if (shouldUpdate && manifest) {
        const info: UpdateInfo = {
          currentVersion: await this.getCurrentVersion(),
          newVersion: manifest.version,
          releaseNotes: manifest.body || undefined,
          releaseDate: manifest.date || undefined,
        };

        this.updateState({
          status: 'update-available',
          info,
          error: null,
        });

        console.log('[UpdateService] Update available:', info.newVersion);
        return info;
      } else {
        this.updateState({
          status: 'up-to-date',
          info: null,
          error: null,
        });

        console.log('[UpdateService] Already up to date');
        return null;
      }
    } catch (error) {
      const errorMessage = this.formatError(error);
      console.error('[UpdateService] Check failed:', errorMessage);

      this.updateState({
        status: 'error',
        error: errorMessage,
      });

      return null;
    }
  }

  /**
   * Download and install the update
   * Returns true if relaunch is needed
   */
  async installUpdate(): Promise<boolean> {
    if (this.state.status !== 'update-available') {
      console.warn('[UpdateService] No update available to install');
      return false;
    }

    this.updateState({
      status: 'downloading',
      progress: { downloaded: 0, total: 0, percent: 0 },
    });

    try {
      // Install update (downloads and applies)
      await installUpdate();

      this.updateState({
        status: 'installing',
        progress: { downloaded: 100, total: 100, percent: 100 },
      });

      console.log('[UpdateService] Update installed, ready to relaunch');
      return true;
    } catch (error) {
      const errorMessage = this.formatError(error);
      console.error('[UpdateService] Install failed:', errorMessage);

      this.updateState({
        status: 'error',
        error: errorMessage,
        progress: null,
      });

      return false;
    }
  }

  /**
   * Relaunch the application to apply the update
   */
  async relaunchApp(): Promise<void> {
    try {
      console.log('[UpdateService] Relaunching application...');
      await relaunch();
    } catch (error) {
      console.error('[UpdateService] Relaunch failed:', error);
      this.updateState({
        status: 'error',
        error: 'Failed to relaunch application. Please restart manually.',
      });
    }
  }

  /**
   * Reset state to idle
   */
  reset(): void {
    this.updateState({
      status: 'idle',
      info: null,
      progress: null,
      error: null,
    });
  }

  /**
   * Check for updates silently on app start
   * Won't show errors to user, just logs them
   */
  async checkSilently(): Promise<void> {
    try {
      await this.initialize();
      const result = await this.checkForUpdates();
      
      if (!result) {
        // Reset to idle if no update (don't show "up-to-date" on startup)
        setTimeout(() => {
          if (this.state.status === 'up-to-date') {
            this.updateState({ status: 'idle' });
          }
        }, 3000);
      }
    } catch (error) {
      console.log('[UpdateService] Silent check failed (network?):', error);
      // Reset to idle on silent check failure
      this.updateState({ status: 'idle', error: null });
    }
  }

  // Private methods

  private updateState(partial: Partial<UpdateState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const stateCopy = { ...this.state };
    this.listeners.forEach((listener) => {
      try {
        listener(stateCopy);
      } catch (error) {
        console.error('[UpdateService] Listener error:', error);
      }
    });
  }

  private async getCurrentVersion(): Promise<string> {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      return await getVersion();
    } catch {
      return 'unknown';
    }
  }

  private formatError(error: unknown): string {
    if (typeof error === 'string') {
      // Clean up common error messages
      if (error.includes('network') || error.includes('fetch')) {
        return 'Network error. Check your internet connection.';
      }
      if (error.includes('signature')) {
        return 'Update signature verification failed.';
      }
      return error;
    }
    
    if (error instanceof Error) {
      return error.message;
    }
    
    return 'Unknown error occurred';
  }
}

// Singleton instance
export const UpdateService = new UpdateServiceClass();
