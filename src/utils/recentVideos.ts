import type { RenderStatRecord } from '../services/StatisticsService';

export interface VideoFolder {
  path: string;
  recursive: boolean;
}

export interface RecentVideoSettings {
  enabled: boolean;
  includeDownloads: boolean;
  folders: VideoFolder[];
}

export interface RecentVideo {
  path: string;
  version: string;
  name: string;
  addedAt: number;
  createdAt?: number;
  thumbnail?: string;
}

export const DEFAULT_RECENT_VIDEOS: RecentVideoSettings = {
  enabled: true,
  includeDownloads: true,
  folders: [],
};

export const RECENT_VIDEO_LIMIT = 3;
export const RECENT_VIDEO_MAX_AGE = 24 * 60 * 60 * 1000;
export const AUTO_FOLDERS_MAX_AGE = 7 * RECENT_VIDEO_MAX_AGE;

export function videoPathKey(path: string): string {
  const slashed = path.replace(/\\/g, '/').replace(/^\/\/\?\/UNC\//i, '//').replace(/^\/\/\?\//, '');
  return /^(?:[a-z]:|\/\/)/i.test(slashed) ? slashed.toLowerCase() : path;
}

export function videoVersionKey(video: RecentVideo): string {
  return JSON.stringify([videoPathKey(video.path), video.version]);
}

type FolderHistory = Pick<RenderStatRecord, 'inputPath' | 'outputPath' | 'status' | 'createdAt' | 'completedAt'>;

export function inferVideoFolders(history: readonly FolderHistory[]): VideoFolder[] {
  const countedFiles = new Set<string>();
  const folders = new Map<string, { path: string; count: number; latest: number }>();
  const outputPaths = new Set(history.filter((record) => record.outputPath).map((record) => videoPathKey(record.outputPath)));
  for (const record of history) {
    if (record.status !== 'completed' || !record.inputPath) continue;
    const key = videoPathKey(record.inputPath);
    const lastSeparator = Math.max(record.inputPath.lastIndexOf('/'), record.inputPath.lastIndexOf('\\'));
    if (lastSeparator < 1 || countedFiles.has(key) || outputPaths.has(key)) continue;
    const path = record.inputPath.slice(0, lastSeparator);
    // A drive root is too broad to use as an automatically inferred source.
    if (/^[a-z]:$/i.test(path) || !/^(?:\/|\\\\|[a-z]:[\\/])/i.test(path)) continue;
    countedFiles.add(key);
    const folderKey = videoPathKey(path);
    const latest = Date.parse(record.completedAt ?? record.createdAt) || 0;
    const folder = folders.get(folderKey);
    folders.set(folderKey, { path, count: (folder?.count ?? 0) + 1, latest: Math.max(folder?.latest ?? 0, latest) });
  }
  return [...folders.values()]
    .sort((left, right) => right.count - left.count || right.latest - left.latest || left.path.localeCompare(right.path))
    .slice(0, RECENT_VIDEO_LIMIT)
    .map(({ path }) => ({ path, recursive: false }));
}

export function readRecentVideoStorage<T>(key: string): T | undefined {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeRecentVideoStorage<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Suggestions remain usable if storage is unavailable.
  }
}
