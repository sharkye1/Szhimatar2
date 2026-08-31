import { useState, useEffect, useCallback } from 'react';
import DownloadService, { DownloadQueueItem } from '../services/DownloadService';

export interface UseDownloadQueueReturn {
  downloadQueue: DownloadQueueItem[];
  startDownload: (
    url: string,
    quality: string,
    format: string,
    label: string,
    savePath: string
  ) => Promise<string>;
  stopDownload: (jobId: string) => Promise<boolean>;
  removeDownloadJob: (jobId: string) => void;
  clearCompletedDownloads: () => void;
}

export function useDownloadQueue(): UseDownloadQueueReturn {
  const [downloadQueue, setDownloadQueue] = useState<DownloadQueueItem[]>(() =>
    DownloadService.getQueue()
  );

  useEffect(() => {
    return DownloadService.subscribe((queue) => {
      setDownloadQueue(queue);
    });
  }, []);

  const startDownload = useCallback(
    async (
      url: string,
      quality: string,
      format: string,
      label: string,
      savePath: string
    ): Promise<string> => {
      return DownloadService.startDownload(url, quality, format, label, savePath);
    },
    []
  );

  const stopDownload = useCallback(async (jobId: string): Promise<boolean> => {
    return DownloadService.stopDownload(jobId);
  }, []);

  const removeDownloadJob = useCallback((jobId: string): void => {
    DownloadService.removeDownload(jobId);
  }, []);

  const clearCompletedDownloads = useCallback((): void => {
    DownloadService.clearCompleted();
  }, []);

  return {
    downloadQueue,
    startDownload,
    stopDownload,
    removeDownloadJob,
    clearCompletedDownloads,
  };
}

export default useDownloadQueue;
