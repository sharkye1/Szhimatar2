import type { DownloadTimeRange } from '../utils/downloadHelpers';
import { invoke } from '@tauri-apps/api/tauri';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { TechnicalDetails } from '../types/technicalDetails';
import { parseTechnicalDetails } from '../utils/technicalDetails';

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
  timeRange?: DownloadTimeRange;
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
  technicalDetails?: TechnicalDetails | null;
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
  details?: TechnicalDetails;
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

  private readonly ready: Promise<void>;

  constructor() {
    this.ready = this.setupEventListeners();
  }

  private async setupEventListeners(): Promise<void> {
    try {
      this.unlistenStarted = await listen<DownloadStartedEvent>('download-started', (event) => {
        const payload = event.payload;
        const current = this.queue.get(payload.job_id);
        if (current && (current.status === 'pending' || current.status === 'downloading')) {
          const item = { ...current };
          item.status = 'downloading';
          if (payload.title && !item.title) {
            item.title = payload.title;
          }
          if (payload.save_path) {
            item.savePath = payload.save_path;
          }
          this.queue.set(payload.job_id, item);
          this.notifyListeners();
        }
      });

      this.unlistenProgress = await listen<DownloadProgressEvent>('download-progress', (event) => {
        const payload = event.payload;
        const current = this.queue.get(payload.job_id);
        if (current && (current.status === 'pending' || current.status === 'downloading')) {
          const item = { ...current };
          item.status = 'downloading';
          item.progress = payload.progress_percent === 0 ? 0 : Math.max(item.progress, payload.progress_percent);
          if (payload.line && payload.progress_percent === 0) {
            item.message = payload.line;
          }
          if (payload.progress_percent >= 99 && !payload.eta) {
            item.eta = null;
            item.speed = null;
          } else {
            if (payload.eta) {
              item.eta = payload.eta;
            }
            if (payload.speed) {
              item.speed = payload.speed;
            }
          }
          item.totalSize = payload.total_size ?? item.totalSize;
          if (payload.title && (!item.title || item.title === item.url)) {
            item.title = payload.title;
          }
          this.queue.set(payload.job_id, item);
          this.notifyListeners();
        }
      });

      this.unlistenComplete = await listen<DownloadCompleteEvent>('download-complete', (event) => {
        const payload = event.payload;
        const current = this.queue.get(payload.job_id);
        if (current && (current.status === 'pending' || current.status === 'downloading')) {
          const item = { ...current };
          let updatedFileName = item.fileName;
          let updatedFormat = item.format;
          if (payload.file_path) {
            const parts = payload.file_path.replace(/\\/g, '/').split('/');
            updatedFileName = parts[parts.length - 1];
            const extMatch = updatedFileName.match(/\.([a-zA-Z0-9]+)$/);
            if (extMatch) {
              updatedFormat = extMatch[1].toLowerCase();
            }
          }

          const updatedItem: DownloadQueueItem = {
            ...item,
            status: 'completed',
            progress: 100,
            eta: null,
            speed: null,
            title: payload.title || item.title,
            filePath: payload.file_path,
            fileSize: payload.file_size,
            fileSizeBytes: payload.file_size_bytes,
            durationSeconds: payload.duration_seconds,
            durationFormatted: payload.duration_formatted,
            savePath: payload.save_path || item.savePath,
            fileName: updatedFileName,
            format: updatedFormat,
          };

          this.queue.set(payload.job_id, updatedItem);
          this.notifyListeners();
        }
      });

      this.unlistenError = await listen<DownloadErrorEvent>('download-error', (event) => {
        const payload = event.payload;
        const current = this.queue.get(payload.job_id);
        if (current && (current.status === 'pending' || current.status === 'downloading')) {
          const item = { ...current };
          const updatedItem: DownloadQueueItem = {
            ...item,
            status: 'error',
            error: payload.error,
            technicalDetails: payload.details || parseTechnicalDetails(payload.error, item.url),
            message: payload.error,
          };
          this.queue.set(payload.job_id, updatedItem);
          this.notifyListeners();
        }
      });

      this.unlistenStopped = await listen<DownloadStoppedEvent>('download-stopped', (event) => {
        const payload = event.payload;
        const current = this.queue.get(payload.job_id);
        if (current && (current.status === 'pending' || current.status === 'downloading')) {
          const item = { ...current };
          const updatedItem: DownloadQueueItem = {
            ...item,
            status: 'stopped',
            message: 'Stopped by user',
          };
          this.queue.set(payload.job_id, updatedItem);
          this.notifyListeners();
        }
      });
    } catch (error) {
      console.error('[DownloadService] Failed to setup event listeners:', error);
      throw error;
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
    initialTitle?: string,
    timeRange?: DownloadTimeRange
  ): Promise<string> {
    await this.ready;
    const jobId = this.createDownloadJobId();
    const item: DownloadQueueItem = {
      id: jobId,
      url,
      title: initialTitle,
      timeRange: timeRange ? { ...timeRange } : undefined,
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
      this.queue.set(jobId, {
        ...item,
        status: 'downloading',
      });
      this.notifyListeners();

      await invoke<string>('download_media_link', {
        url,
        quality,
        format,
        savePath: item.savePath,
        jobId,
        initialTitle: initialTitle || null,
        timeRange: item.timeRange || null,
      });
    } catch (error) {
      console.error('[DownloadService] Download failed:', error);
      const current = this.queue.get(jobId);
      if (!current || !['pending', 'downloading'].includes(current.status)) return jobId;
      this.queue.set(jobId, {
        ...current,
        status: 'error',
        error: String(error),
        technicalDetails: parseTechnicalDetails(error, current.url),
        message: String(error),
      });
      this.notifyListeners();
    }

    return jobId;
  }

  public async stopDownload(jobId: string): Promise<boolean> {
    try {
      // The backend stopped event confirms completion of cancellation.
      return await invoke<boolean>('stop_media_download', { jobId });
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

