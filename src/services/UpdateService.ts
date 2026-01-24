/**
 * UpdateService - Simple Update System (No Signing Required)
 * 
 * Downloads updates directly from GitHub Releases.
 * Supports .exe and .zip files with optional SHA256 hash verification.
 */

import { invoke } from '@tauri-apps/api/tauri';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';

// Update endpoint - latest.json location
const UPDATE_ENDPOINT = 'https://github.com/sharkye1/Szhimatar2/releases/latest/download/latest.json';

export type UpdateStatus = 
  | 'idle'
  | 'checking'
  | 'update-available'
  | 'downloading'
  | 'ready-to-install'
  | 'up-to-date'
  | 'error';

export interface UpdateManifest {
  version: string;
  notes: string;
  pub_date?: string;
  platforms: {
    [key: string]: {
      url: string;
      hash?: string;  // Optional SHA256 hash for integrity check
    };
  };
}

export interface UpdateInfo {
  currentVersion: string;
  newVersion: string;
  releaseNotes?: string;
  releaseDate?: string;
  downloadUrl: string;
  hash?: string;
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
  private progressUnlisten: UnlistenFn | null = null;
  private isInitialized = false;

  /**
   * Initialize the update service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Listen for download progress events from Rust
      this.progressUnlisten = await listen<{ downloaded: number; total: number }>(
        'update-download-progress',
        (event) => {
          const { downloaded, total } = event.payload;
          const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
          
          this.updateState({
            progress: { downloaded, total, percent },
          });
        }
      );

      this.isInitialized = true;
      console.log('[UpdateService] Initialized (simple mode, no signing)');
    } catch (error) {
      console.error('[UpdateService] Failed to initialize:', error);
    }
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    if (this.progressUnlisten) {
      this.progressUnlisten();
      this.progressUnlisten = null;
    }
    this.listeners.clear();
    this.isInitialized = false;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: UpdateListener): () => void {
    this.listeners.add(listener);
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
   * Get current platform key for latest.json
   */
  private getPlatformKey(): string {
    // Detect platform
    const platform = navigator.platform.toLowerCase();
    
    if (platform.includes('win')) {
      return 'windows-x86_64';
    } else if (platform.includes('mac')) {
      return 'darwin-x86_64';
    } else if (platform.includes('linux')) {
      return 'linux-x86_64';
    }
    
    return 'windows-x86_64'; // Default
  }

  /**
   * Compare semantic versions
   * Returns true if newVersion > currentVersion
   */
  private isNewerVersion(currentVersion: string, newVersion: string): boolean {
    const current = currentVersion.replace(/^v/, '').split('.').map(Number);
    const next = newVersion.replace(/^v/, '').split('.').map(Number);

    for (let i = 0; i < Math.max(current.length, next.length); i++) {
      const c = current[i] || 0;
      const n = next[i] || 0;
      if (n > c) return true;
      if (n < c) return false;
    }
    return false;
  }

  /**
   * Check for available updates
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
      // Fetch latest.json via Tauri's native HTTP client to avoid CORS
      const response = await tauriFetch<UpdateManifest>(UPDATE_ENDPOINT, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        responseType: ResponseType.JSON,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch update manifest: ${response.status}`);
      }

      const manifest: UpdateManifest = response.data;
      const platformKey = this.getPlatformKey();
      const platformData = manifest.platforms[platformKey];

      if (!platformData) {
        console.log(`[UpdateService] No update available for platform: ${platformKey}`);
        this.updateState({ status: 'up-to-date' });
        return null;
      }

      // Get current version
      const currentVersion = await this.getCurrentVersion();
      
      // Check if update is needed
      if (!this.isNewerVersion(currentVersion, manifest.version)) {
        console.log(`[UpdateService] Up to date (current: ${currentVersion}, latest: ${manifest.version})`);
        this.updateState({ status: 'up-to-date' });
        return null;
      }

      // Update available!
      const info: UpdateInfo = {
        currentVersion,
        newVersion: manifest.version,
        releaseNotes: manifest.notes,
        releaseDate: manifest.pub_date,
        downloadUrl: platformData.url,
        hash: platformData.hash,
      };

      this.updateState({
        status: 'update-available',
        info,
        error: null,
      });

      console.log('[UpdateService] Update available:', manifest.version);
      return info;

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
   * Download and prepare the update
   */
  async downloadUpdate(): Promise<boolean> {
    if (!this.state.info) {
      console.warn('[UpdateService] No update info available');
      return false;
    }

    if (this.state.status === 'downloading') {
      console.warn('[UpdateService] Already downloading');
      return false;
    }

    this.updateState({
      status: 'downloading',
      progress: { downloaded: 0, total: 0, percent: 0 },
    });

    try {
      const { downloadUrl, hash } = this.state.info;

      // Call Rust command to download update
      const result = await invoke<{ success: boolean; path: string; error?: string }>(
        'download_update',
        {
          url: downloadUrl,
          expectedHash: hash || null,
        }
      );

      if (!result.success) {
        throw new Error(result.error || 'Download failed');
      }

      this.updateState({
        status: 'ready-to-install',
        progress: { downloaded: 100, total: 100, percent: 100 },
      });

      console.log('[UpdateService] Update downloaded to:', result.path);
      return true;

    } catch (error) {
      const errorMessage = this.formatError(error);
      console.error('[UpdateService] Download failed:', errorMessage);

      this.updateState({
        status: 'error',
        error: errorMessage,
        progress: null,
      });

      return false;
    }
  }

  /**
   * Apply the downloaded update (replace exe and restart)
   */
  async applyUpdate(): Promise<boolean> {
    if (this.state.status !== 'ready-to-install') {
      console.warn('[UpdateService] Update not ready to install');
      return false;
    }

    try {
      // Call Rust command to apply update
      const result = await invoke<{ success: boolean; error?: string }>(
        'apply_update'
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to apply update');
      }

      console.log('[UpdateService] Update applied, restarting...');
      
      // Restart the application
      await invoke('restart_app');
      
      return true;

    } catch (error) {
      const errorMessage = this.formatError(error);
      console.error('[UpdateService] Apply failed:', errorMessage);

      this.updateState({
        status: 'error',
        error: errorMessage,
      });

      return false;
    }
  }

  /**
   * Combined: Download and install update
   */
  async installUpdate(): Promise<boolean> {
    const downloaded = await this.downloadUpdate();
    if (!downloaded) return false;

    return true; // Ready to install, user needs to confirm restart
  }

  /**
   * Restart the application
   */
  async restartApp(): Promise<void> {
    try {
      await invoke('restart_app');
    } catch (error) {
      console.error('[UpdateService] Restart failed:', error);
      this.updateState({
        status: 'error',
        error: 'Failed to restart. Please restart manually.',
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
   */
  async checkSilently(): Promise<void> {
    try {
      await this.initialize();
      const result = await this.checkForUpdates();
      
      if (!result) {
        // Reset to idle if no update
        setTimeout(() => {
          if (this.state.status === 'up-to-date') {
            this.updateState({ status: 'idle' });
          }
        }, 3000);
      }
    } catch (error) {
      console.log('[UpdateService] Silent check failed:', error);
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
      return await getVersion();
    } catch {
      return 'unknown';
    }
  }

  private formatError(error: unknown): string {
    // Check if error is string
    if (typeof error === 'string') {
      if (error.includes('network') || error.includes('fetch')) {
        return 'Ошибка сети. Проверьте подключение к интернету.';
      }
      if (error.includes('hash') || error.includes('integrity')) {
        return 'Ошибка проверки целостности файла.';
      }
      return error;
    }
    
    if (error instanceof Error) {
      return error.message;
    }
    
    return 'Неизвестная ошибка';
  }
}
 
// Singleton instance
export const UpdateService = new UpdateServiceClass();
