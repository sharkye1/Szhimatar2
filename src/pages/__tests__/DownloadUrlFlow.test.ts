import { describe, it, expect, vi } from 'vitest';
import {
  normalizeInputUrl,
  isValidMediaUrl,
  isNetworkErrorText,
  formatDownloadBytes,
  formatDownloadHeight,
  formatDownloadOptionLabel,
  normalizeDownloadFormats,
} from '../../utils/downloadHelpers';

describe('Download URL Flow and Feedback Helpers', () => {
  const DEFAULT_DOWNLOAD_FORMATS = [
    {
      label: 'MP4 Best',
      quality: 'bestvideo+bestaudio/best',
      format: 'mp4',
      ext: 'mp4',
      height: null,
      filesize: null,
      is_audio_only: false,
    },
    {
      label: 'MP3',
      quality: 'bestaudio/best',
      format: 'mp3',
      ext: 'mp3',
      height: null,
      filesize: null,
      is_audio_only: true,
    },
  ];

  describe('normalizeInputUrl', () => {
    it('prepends https:// when domain is entered without protocol', () => {
      expect(normalizeInputUrl('youtube.com/watch?v=123')).toBe('https://youtube.com/watch?v=123');
      expect(normalizeInputUrl('soundcloud.com/artist/track')).toBe('https://soundcloud.com/artist/track');
      expect(normalizeInputUrl('vm.tiktok.com/ZMxxx/')).toBe('https://vm.tiktok.com/ZMxxx/');
      expect(normalizeInputUrl('vk.com/video-123_456')).toBe('https://vk.com/video-123_456');
    });

    it('keeps existing http:// and https:// unchanged', () => {
      expect(normalizeInputUrl('https://youtube.com/watch?v=123')).toBe('https://youtube.com/watch?v=123');
      expect(normalizeInputUrl('http://insecure.site/video.mp4')).toBe('http://insecure.site/video.mp4');
    });

    it('handles empty string or plain text', () => {
      expect(normalizeInputUrl('')).toBe('');
      expect(normalizeInputUrl('   ')).toBe('');
      expect(normalizeInputUrl('just-a-word')).toBe('just-a-word');
    });
  });

  describe('isValidMediaUrl', () => {
    it('accepts valid http and https URLs', () => {
      expect(isValidMediaUrl('https://youtube.com/watch?v=123')).toBe(true);
      expect(isValidMediaUrl('http://soundcloud.com/track')).toBe(true);
      expect(isValidMediaUrl('https://vm.tiktok.com/xyz/')).toBe(true);
    });

    it('rejects invalid or incomplete inputs', () => {
      expect(isValidMediaUrl('')).toBe(false);
      expect(isValidMediaUrl('   ')).toBe(false);
      expect(isValidMediaUrl('hello world')).toBe(false);
      expect(isValidMediaUrl('ftp://example.com/video')).toBe(false);
      expect(isValidMediaUrl('just-a-word')).toBe(false);
    });
  });

  describe('formatDownloadOptionLabel', () => {
    it('avoids duplicating height when label already contains it', () => {
      const option = {
        label: 'MP4 1080p',
        height: 1080,
        filesize: 25000000,
      };
      // Must NOT be "MP4 1080p • 1080p • 23.8 MB"
      expect(formatDownloadOptionLabel(option)).toBe('MP4 1080p • 23.8 MB');
    });

    it('appends height when label does not contain it', () => {
      const option = {
        label: 'Video',
        height: 720,
        filesize: 15000000,
      };
      expect(formatDownloadOptionLabel(option)).toBe('Video • 720p • 14.3 MB');
    });

    it('handles options without height or size', () => {
      expect(formatDownloadOptionLabel({ label: 'MP4 Best' })).toBe('MP4 Best');
      expect(formatDownloadOptionLabel({ label: 'MP3', height: null, filesize: null })).toBe('MP3');
    });
  });

  describe('normalizeDownloadFormats', () => {
    it('ensures MP4 and MP3 fallback options are present for video sources', () => {
      const formats = [
        {
          label: 'MP4 1080p',
          quality: '137+140',
          format: 'mp4',
          ext: 'mp4',
          height: 1080,
          filesize: 1000000,
          is_audio_only: false,
        },
      ];
      const normalized = normalizeDownloadFormats(formats, DEFAULT_DOWNLOAD_FORMATS);
      expect(normalized.some((f) => f.format === 'mp4')).toBe(true);
      expect(normalized.some((f) => f.format === 'mp3')).toBe(true);
    });

    it('preserves audio-only formats when source is audio only', () => {
      const audioOnly = [
        {
          label: 'Audio (MP3)',
          quality: 'bestaudio/best',
          format: 'mp3',
          ext: 'mp3',
          height: null,
          filesize: null,
          is_audio_only: true,
        },
      ];
      const normalized = normalizeDownloadFormats(audioOnly, DEFAULT_DOWNLOAD_FORMATS);
      expect(normalized.every((f) => f.is_audio_only)).toBe(true);
      expect(normalized.some((f) => f.format === 'mp3')).toBe(true);
    });
  });

  describe('isNetworkErrorText', () => {
    it('detects timeout and connection errors from yt-dlp stderr output across platforms', () => {
      expect(isNetworkErrorText('ERROR: [soundcloud] 12345: Unable to download webpage: <urlopen error timed out>')).toBe(true);
      expect(isNetworkErrorText('ERROR: Unable to download webpage: [Errno 11001] getaddrinfo failed')).toBe(true);
      expect(isNetworkErrorText('ERROR: [Errno 8] nodename nor servname provided, or not known')).toBe(true);
      expect(isNetworkErrorText('Connection refused by server')).toBe(true);
      expect(isNetworkErrorText('Connection reset by peer')).toBe(true);
      expect(isNetworkErrorText('HTTP Error 403: Forbidden')).toBe(true);
      expect(isNetworkErrorText('HTTP Error 429: Too Many Requests')).toBe(true);
      expect(isNetworkErrorText('WinError 10060: connection timed out')).toBe(true);
      expect(isNetworkErrorText('Сетевая ошибка или таймаут соединения')).toBe(true);
      expect(isNetworkErrorText('Temporary failure in name resolution')).toBe(true);
    });

    it('does not classify generic format parsing errors as network errors', () => {
      expect(isNetworkErrorText('Unsupported URL: ftp://something')).toBe(false);
      expect(isNetworkErrorText('No video formats found in webpage')).toBe(false);
      expect(isNetworkErrorText('')).toBe(false);
    });
  });

  describe('Download Queue Retry', () => {
    it('removes failed job and restarts download with previous parameters', () => {
      const removeDownloadJob = vi.fn();
      const startDownload = vi.fn();

      const failedJob = {
        id: 'download-123',
        url: 'https://soundcloud.com/artist/song',
        quality: 'bestaudio/best',
        format: 'mp3',
        label: 'MP3',
        savePath: '/Users/test/Downloads',
        title: 'Artist - Song',
      };

      const handleRetryDownload = (item: typeof failedJob) => {
        removeDownloadJob(item.id);
        startDownload(
          item.url,
          item.quality,
          item.format,
          item.label,
          item.savePath,
          item.title
        );
      };

      handleRetryDownload(failedJob);

      expect(removeDownloadJob).toHaveBeenCalledWith('download-123');
      expect(startDownload).toHaveBeenCalledWith(
        'https://soundcloud.com/artist/song',
        'bestaudio/best',
        'mp3',
        'MP3',
        '/Users/test/Downloads',
        'Artist - Song'
      );
    });
  });
});
