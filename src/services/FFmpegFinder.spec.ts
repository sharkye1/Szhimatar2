import { afterEach, expect, it, vi } from 'vitest';
import { getBinaryVersion, loadFFmpegPaths, searchFFmpegSingle } from '../utils/ffmpeg';
import { resetPlatformOverride, setPlatformOverride } from '../utils/platform';
import { ffmpegFinder } from './FFmpegFinder';

vi.mock('../utils/ffmpeg');

afterEach(() => {
  ffmpegFinder.clearCache();
  resetPlatformOverride();
  vi.resetAllMocks();
});

it.each([
  ['macos', '/opt/homebrew/Cellar/ffmpeg/8.0/bin/ffmpeg', '/opt/homebrew/Cellar/ffmpeg/8.0/bin/ffprobe'],
  ['windows', 'C:/Tools/FFmpeg/bin/ffmpeg.exe', 'C:/Tools/FFmpeg/bin/ffprobe.exe'],
] as const)('finds ffprobe beside ffmpeg on %s', async (os, ffmpeg, ffprobe) => {
  setPlatformOverride(os);
  vi.mocked(loadFFmpegPaths).mockResolvedValue({ ffmpeg_path: '', ffprobe_path: '' });
  vi.mocked(searchFFmpegSingle).mockResolvedValue({ found: true, path: ffmpeg, version: '8.0' });
  vi.mocked(getBinaryVersion).mockImplementation(async path => ({
    output: path === ffmpeg || path === ffprobe ? '8.0' : '',
  }));

  expect((await ffmpegFinder.findFFmpeg()).ffprobe?.path).toBe(ffprobe);
  expect(searchFFmpegSingle).toHaveBeenCalledTimes(1);
  expect(searchFFmpegSingle).toHaveBeenCalledWith('ffmpeg');
});
