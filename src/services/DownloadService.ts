import { invoke } from '@tauri-apps/api/tauri';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'error' | 'stopped';

export interface DownloadQueueItem {
  id: string;
  url: string;
  title?: string;
  fileName?: string;
  filePath?: string;
  label: string;
  quality: string;
  format: string;
  savePath: string;
  status: DownloadStatus;
  progress: number;
  eta?: string | null;
  speed?: string | null;
  totalSize?: string | null;
  fileSize?: string | null;
  fileSizeBytes?: number | null;
  durationSeconds?: number | null;
  durationFormatted?: string | null;
  error?: string | null;
  message?: string;
}

export interface DownloadStartedEvent {
  job_id: string;
  url: string;
  title?: string | null;
  save_path: string;
}

export interface DownloadProgressEvent {
  job_id: string;
  url: string;
  title?: string | null;
  progress_percent: number;
  eta?: string | null;
  speed?: string | null;
  total_size?: string | null;
  line?: string;
}

export interface DownloadCompleteEvent {
  job_id: string;
  url: string;
  title: string;
  file_path: string;
  file_size: string;
  file_size_bytes: number;
  duration_seconds?: number | null;
  duration_formatted?: string | null;
  save_path: string;
}

export interface DownloadErrorEvent {
  job_id: string;
  url: string;
  error: string;
}

export interface DownloadStoppedEvent {
  job_id: string;
  stopped_by: string;
}

export type DownloadQueueListener = (queue: DownloadQueueItem[]) => void;

class DownloadServiceImpl {
  private queue: Map<string, DownloadQueueItem> = new Map();
  private listeners: Set<DownloadQueueListener> = new Set();
  private unlistenStarted: UnlistenFn | null = null;
  private unlistenProgress: UnlistenFn | null = null;
  private unlistenComplete: UnlistenFn | null = null;
  private unlistenError: UnlistenFn | null = null;
  private unlistenStopped: UnlistenFn | null = null;

  constructor() {
    this.setupEventListeners();
  }

  private async setupEventListeners(): Promise<void> {
    try {
      this.unlistenStarted = await listen<DownloadStartedEvent>('download-started', (event) => {
        const payload = event.payload;
        const item = this.queue.get(payload.job_id);
        if (item) {
          item.status = 'downloading';
          if (payload.title && !item.title) {
            item.title = payload.title;
          }
          if (payload.save_path) {
            item.savePath = payload.save_path;
          }
          this.notifyListeners();
        }
      });

      this.unlistenProgress = await listen<DownloadProgressEvent>('download-progress', (event) => {
        const payload = event.payload;
        const item = this.queue.get(payload.job_id);
        if (item) {
          item.status = 'downloading';
          item.progress = payload.progress_percent;
          item.eta = payload.eta ?? item.eta;
          item.speed = payload.speed ?? item.speed;
          item.totalSize = payload.total_size ?? item.totalSize;
          if (payload.title && !item.title) {
            item.title = payload.title;
          }
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
          item.title = payload.title || item.title;
          item.filePath = payload.file_path;
          item.fileSize = payload.file_size;
          item.fileSizeBytes = payload.file_size_bytes;
          item.durationSeconds = payload.duration_seconds;
          item.durationFormatted = payload.duration_formatted;
          item.savePath = payload.save_path || item.savePath;

          if (payload.file_path) {
            const parts = payload.file_path.replace(/\\/g, '/').split('/');
            item.fileName = parts[parts.length - 1];
          }

          this.notifyListeners();
        }
      });

      this.unlistenError = await listen<DownloadErrorEvent>('download-error', (event) => {
        const payload = event.payload;
        const item = this.queue.get(payload.job_id);
        if (item) {
          item.status = 'error';
          item.error = payload.error;
          item.message = payload.error;
          this.notifyListeners();
        }
      });

      this.unlistenStopped = await listen<DownloadStoppedEvent>('download-stopped', (event) => {
        const payload = event.payload;
        const item = this.queue.get(payload.job_id);
        if (item) {
          item.status = 'stopped';
          item.message = 'Stopped by user';
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
    savePath: string,
    initialTitle?: string
  ): Promise<string> {
    const jobId = this.createDownloadJobId();
    const item: DownloadQueueItem = {
      id: jobId,
      url,
      title: initialTitle,
      label,
      quality,
      format,
      savePath: savePath || '',
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
        initialTitle: initialTitle || null,
      });
    } catch (error) {
      console.error('[DownloadService] Download failed:', error);
      item.status = 'error';
      item.error = String(error);
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
        item.status = 'stopped';
        item.message = 'Stopped by user';
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
      if (item.status === 'completed' || item.status === 'stopped' || item.status === 'error') {
        toRemove.push(id);
      }
    });
    toRemove.forEach((id) => this.queue.delete(id));
    this.notifyListeners();
  }
}

export const DownloadService = new DownloadServiceImpl();
export default DownloadService;

