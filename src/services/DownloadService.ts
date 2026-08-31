import { invoke } from '@tauri-apps/api/tauri';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'error';

export interface DownloadQueueItem {
  id: string;
  url: string;
  label: string;
  quality: string;
  format: string;
  savePath: string;
  status: DownloadStatus;
  progress: number;
  eta?: string | null;
  speed?: string | null;
  message?: string;
}

export interface DownloadProgressEvent {
  job_id: string;
  url: string;
  progress_percent: number;
  eta?: string | null;
  speed?: string | null;
  line?: string;
}

export interface DownloadCompleteEvent {
  job_id: string;
  url: string;
  save_path: string;
}

export interface DownloadErrorEvent {
  job_id: string;
  url: string;
  error: string;
}

export type DownloadQueueListener = (queue: DownloadQueueItem[]) => void;

class DownloadServiceImpl {
  private queue: Map<string, DownloadQueueItem> = new Map();
  private listeners: Set<DownloadQueueListener> = new Set();
  private unlistenProgress: UnlistenFn | null = null;
  private unlistenComplete: UnlistenFn | null = null;
  private unlistenError: UnlistenFn | null = null;

  constructor() {
    this.setupEventListeners();
  }

  private async setupEventListeners(): Promise<void> {
    try {
      this.unlistenProgress = await listen<DownloadProgressEvent>('download-progress', (event) => {
        const payload = event.payload;
        const item = this.queue.get(payload.job_id);
        if (item) {
          item.status = 'downloading';
          item.progress = payload.progress_percent;
          item.eta = payload.eta ?? item.eta;
          item.speed = payload.speed ?? item.speed;
          this.notifyListeners();
        }
      });

      this.unlistenComplete = await listen<DownloadCompleteEvent>('download-complete', (event) => {
        const payload = event.payload;
        const item = this.queue.get(payload.job_id);
        if (item) {
          item.status = 'completed';
          item.progress = 100;
          item.eta = null;
          item.speed = null;
          item.message = payload.save_path;
          this.notifyListeners();
        }
      });

      this.unlistenError = await listen<DownloadErrorEvent>('download-error', (event) => {
        const payload = event.payload;
        const item = this.queue.get(payload.job_id);
        if (item) {
          item.status = 'error';
          item.message = payload.error;
          this.notifyListeners();
        }
      });
    } catch (error) {
      console.error('[DownloadService] Failed to setup event listeners:', error);
    }
  }

  public subscribe(listener: DownloadQueueListener): () => void {
    this.listeners.add(listener);
    listener(this.getQueue());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const items = this.getQueue();
    this.listeners.forEach((listener) => {
      try {
        listener(items);
      } catch (err) {
        console.error('[DownloadService] Listener error:', err);
      }
    });
  }

  public getQueue(): DownloadQueueItem[] {
    return Array.from(this.queue.values());
  }

  public createDownloadJobId(): string {
    return `download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  public async startDownload(
    url: string,
    quality: string,
    format: string,
    label: string,
    savePath: string
  ): Promise<string> {
    const jobId = this.createDownloadJobId();
    const item: DownloadQueueItem = {
      id: jobId,
      url,
      label,
      quality,
      format,
      savePath: savePath || 'Downloads',
      status: 'pending',
      progress: 0,
      eta: null,
      speed: null,
    };

    this.queue.set(jobId, item);
    this.notifyListeners();

    try {
      item.status = 'downloading';
      this.notifyListeners();

      await invoke<string>('download_media_link', {
        url,
        quality,
        format,
        savePath: item.savePath,
        jobId,
      });
    } catch (error) {
      console.error('[DownloadService] Download failed:', error);
      item.status = 'error';
      item.message = String(error);
      this.notifyListeners();
    }

    return jobId;
  }

  public async stopDownload(jobId: string): Promise<boolean> {
    try {
      await invoke('stop_media_download', { jobId });
      const item = this.queue.get(jobId);
      if (item && item.status === 'downloading') {
        item.status = 'error';
        item.message = 'Cancelled';
        this.notifyListeners();
      }
      return true;
    } catch (error) {
      console.error('[DownloadService] Failed to stop download:', error);
      return false;
    }
  }

  public removeDownload(jobId: string): void {
    this.queue.delete(jobId);
    this.notifyListeners();
  }

  public clearCompleted(): void {
    const toRemove: string[] = [];
    this.queue.forEach((item, id) => {
      if (item.status === 'completed') {
        toRemove.push(id);
      }
    });
    toRemove.forEach((id) => this.queue.delete(id));
    this.notifyListeners();
  }
}

export const DownloadService = new DownloadServiceImpl();
export default DownloadService;
