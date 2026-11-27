import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { useSettings } from '../contexts/SettingsContext';
import StatisticsService, { type RenderStatRecord } from '../services/StatisticsService';
import {
  AUTO_FOLDERS_MAX_AGE, inferVideoFolders, readRecentVideoStorage, RECENT_VIDEO_MAX_AGE,
  type RecentVideo, type VideoFolder, videoPathKey, videoVersionKey, writeRecentVideoStorage,
} from '../utils/recentVideos';

const AUTO_FOLDERS_KEY = 'szhimatar.recent-video-folders.v1';
export const RECENT_VIDEO_CACHE_KEY = 'szhimatar.recent-video-cache.v3';
const NO_FOLDERS: VideoFolder[] = [];

interface AutoFolders {
  checkedAt: number;
  folders: VideoFolder[];
}

interface VideoSnapshot {
  scope: string;
  videos: RecentVideo[];
}

interface ScanResult {
  videos: RecentVideo[];
  settling: boolean;
}

export function useRecentVideos(queuePaths: string[]) {
  const { settings, isLoaded } = useSettings();
  const { enabled, includeDownloads, folders } = settings.recentVideos;
  const [autoFolders, setAutoFolders] = useState(() => readRecentVideoStorage<AutoFolders>(AUTO_FOLDERS_KEY));
  const autoFoldersRef = useRef(autoFolders);
  const [snapshot, setSnapshot] = useState(() => readRecentVideoStorage<VideoSnapshot>(RECENT_VIDEO_CACHE_KEY));
  const [historyPaths, setHistoryPaths] = useState<string[]>();
  const historyLoaded = historyPaths !== undefined;
  const requestRefresh = useRef<() => void>(() => {});

  const sourceFolders = folders.length ? folders : autoFolders?.folders ?? NO_FOLDERS;
  const scope = JSON.stringify([includeDownloads, sourceFolders, settings.output_suffix]);
  // The scan always reads the latest exclusions, including items added while a scan is in flight.
  const excluded = [...new Set([...queuePaths.filter(Boolean).map(videoPathKey), ...(historyPaths ?? [])])].sort();
  const exclusionKey = JSON.stringify(excluded);
  const exclusionsRef = useRef(excluded);
  exclusionsRef.current = excluded;

  useEffect(() => {
    if (!isLoaded || !enabled) return;
    let cancelled = false;
    function considerHistory(records: readonly RenderStatRecord[]) {
      if (cancelled) return;
      const paths = [...new Set([
        ...StatisticsService.getProcessedVideoPaths(),
        ...records.map((entry) => entry.outputPath).filter(Boolean).map(videoPathKey),
      ])];
      setHistoryPaths((previous) => (
        previous?.length === paths.length && previous.every((path, index) => path === paths[index]) ? previous : paths
      ));
      if (folders.length) return;
      const previous = autoFoldersRef.current;
      const now = Date.now();
      const hasNewHistory = previous?.folders.length === 0 && records.some((record) =>
        record.status === 'completed' && Date.parse(record.completedAt ?? record.createdAt) > previous.checkedAt
      );
      if (previous && now - previous.checkedAt < AUTO_FOLDERS_MAX_AGE && !hasNewHistory) return;
      const next = { checkedAt: now, folders: inferVideoFolders(records) };
      autoFoldersRef.current = next;
      setAutoFolders(next);
      writeRecentVideoStorage(AUTO_FOLDERS_KEY, next);
    }
    const considerLoadedHistory = () => {
      if (StatisticsService.isLoaded()) considerHistory(StatisticsService.getRenders());
    };
    const unsubscribe = StatisticsService.subscribe((stats) => considerHistory(stats.renders));
    considerLoadedHistory();
    void StatisticsService.init().then((stats) => considerHistory(stats.renders), console.warn);
    window.addEventListener('focus', considerLoadedHistory);
    const interval = window.setInterval(considerLoadedHistory, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(interval);
      window.removeEventListener('focus', considerLoadedHistory);
    };
  }, [enabled, folders, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!enabled) {
      void invoke('watch_recent_video_folders', { folders: [], includeDownloads: false }).catch(console.warn);
      setSnapshot(undefined);
      writeRecentVideoStorage(RECENT_VIDEO_CACHE_KEY, null);
      return;
    }
    if (!historyLoaded) return;
    let cancelled = false;
    let running = false;
    let needsAnotherScan = false;
    let pending: number | undefined;
    let settleRetries = 0;
    const sources = { folders: sourceFolders, includeDownloads };
    const schedule = (delay = 0) => {
      if (cancelled) return;
      if (running) {
        needsAnotherScan = true;
      } else if (pending === undefined || delay === 0) {
        window.clearTimeout(pending);
        pending = window.setTimeout(() => void scan(), delay);
      }
    };
    const scan = async () => {
      pending = undefined;
      running = true;
      let settling = false;
      try {
        const result = await invoke<ScanResult>('list_recent_videos', {
          ...sources,
          excluded: exclusionsRef.current,
          outputSuffix: settings.output_suffix,
        });
        if (cancelled) return;
        settling = result.settling;
        setSnapshot((previous) => {
          const previousVideos = new Map(previous?.videos.map((video) => [videoVersionKey(video), video]));
          const videos = result.videos.map((video) => ({
            ...video,
            thumbnail: previousVideos.get(videoVersionKey(video))?.thumbnail,
          }));
          if (previous?.scope === scope && previous.videos.length === videos.length &&
              previous.videos.every((video, index) => (
                video.path === videos[index].path && video.version === videos[index].version &&
                video.addedAt === videos[index].addedAt && video.createdAt === videos[index].createdAt
              ))) return previous;
          return { scope, videos };
        });
      } catch (error) {
        if (!cancelled) {
          console.warn('[Recent videos] Scan failed:', error);
          setSnapshot((previous) => previous?.scope === scope ? previous : { scope, videos: [] });
        }
      } finally {
        running = false;
        if (needsAnotherScan) {
          needsAnotherScan = false;
          schedule(500);
        } else if (settling && settleRetries < 3) {
          settleRetries++;
          schedule(2200);
        } else if (!settling) {
          settleRetries = 0;
        }
      }
    };
    const watch = () => {
      if (!cancelled) void invoke('watch_recent_video_folders', sources).catch(console.warn);
    };
    const unsubscribe = listen('recent-videos-changed', () => {
      settleRetries = 0;
      schedule(550);
    });
    void unsubscribe.then(watch, watch);
    const refresh = () => {
      settleRetries = 0;
      schedule();
    };
    requestRefresh.current = refresh;
    refresh();
    const interval = window.setInterval(() => {
      watch();
      refresh();
    }, 45_000);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.clearTimeout(pending);
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      void unsubscribe.then((remove) => remove(), () => {});
    };
  }, [enabled, historyLoaded, includeDownloads, isLoaded, scope, sourceFolders, settings.output_suffix]);

  useEffect(() => {
    requestRefresh.current();
  }, [exclusionKey]);

  const excludeSet = new Set(excluded);
  const current = historyLoaded && snapshot?.scope === scope ? snapshot : undefined;
  const videos = (current?.videos ?? []).filter((video) =>
    !excludeSet.has(videoPathKey(video.path)) && Date.now() - video.addedAt <= RECENT_VIDEO_MAX_AGE
  );
  const thumbnailSequence = JSON.stringify(videos.map(videoVersionKey));
  const videosRef = useRef(videos);
  videosRef.current = videos;

  useEffect(() => {
    if (!isLoaded || !enabled) return;
    let cancelled = false;
    async function loadThumbnails() {
      for (const video of videosRef.current) {
        if (cancelled) return;
        if (video.thumbnail) continue;
        try {
          const thumbnail = await invoke<string>('get_recent_video_thumbnail', { path: video.path, version: video.version });
          if (cancelled) return;
          const key = videoVersionKey(video);
          setSnapshot((previous) => previous?.scope === scope ? {
            ...previous,
            videos: previous.videos.map((item) => videoVersionKey(item) === key ? { ...item, thumbnail } : item),
          } : previous);
        } catch {
          // The file stays available to add if thumbnail extraction fails.
        }
      }
    }
    void loadThumbnails();
    return () => { cancelled = true; };
  }, [enabled, isLoaded, scope, settings.ffmpeg_path, thumbnailSequence]);

  useEffect(() => {
    if (enabled && isLoaded && current) writeRecentVideoStorage(RECENT_VIDEO_CACHE_KEY, current);
  }, [enabled, isLoaded, current]);

  const refresh = useCallback(() => requestRefresh.current(), []);
  return { enabled, videos, loading: !isLoaded || !current, refresh };
}
