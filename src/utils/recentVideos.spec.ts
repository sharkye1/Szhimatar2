import { describe, expect, it } from 'vitest';
import { inferVideoFolders, videoPathKey } from './recentVideos';

const completed = (inputPath: string, createdAt = '2026-11-25', outputPath = '/exports/output.mp4') => ({
  inputPath, createdAt, outputPath, status: 'completed' as const,
});

describe('recent video folders', () => {
  it('counts different successful source files, including equivalent Windows path spellings', () => {
    const result = inferVideoFolders([
      completed('C:\\Clips\\Desktop\\a.mp4'),
      completed('c:/clips/desktop/A.MP4'),
      completed('C:\\Clips\\Game\\one.mp4'),
      completed('C:\\Clips\\Game\\two.mp4'),
      { ...completed('C:\\Clips\\Other\\a.mp4'), status: 'error' },
      { ...completed('C:\\Clips\\Other\\b.mp4'), status: 'cancelled' },
    ]);
    expect(result.map(({ path }) => videoPathKey(path))).toEqual(['c:/clips/game', 'c:/clips/desktop']);
    expect(result.every(({ recursive }) => !recursive)).toBe(true);
  });

  it('prefers recently used folders on a tie and skips saved outputs, relative paths and drive roots', () => {
    const result = inferVideoFolders([
      completed('C:\\clips\\old\\a.mp4', '2026-11-20'),
      completed('C:\\clips\\latest\\a.mp4', '2026-11-26', 'C:/Exports/Small.mp4'),
      completed('c:\\exports\\small.mp4', '2026-11-26'),
      completed('C:\\a.mp4', '2026-11-26'),
      completed('folder/a.mp4', '2026-11-26'),
      completed('/home/me/other/b.mkv', '2026-11-21'),
      completed('/home/me/fourth/c.mov', '2026-11-18'),
    ]);
    expect(result.map(({ path }) => videoPathKey(path))).toEqual([
      'c:/clips/latest', '/home/me/other', 'c:/clips/old',
    ]);
  });
});
