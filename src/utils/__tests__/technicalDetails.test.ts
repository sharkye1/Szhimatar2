import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyErrorText,
  parseTechnicalDetails,
  formatDiagnosticReport,
  copyTextToClipboard,
} from '../technicalDetails';
import { TechnicalDetails } from '../../types/technicalDetails';

describe('Technical Details and Diagnostic Error Reporting', () => {
  describe('classifyErrorText', () => {
    it('classifies ECONNRESET and Errno 54 correctly', () => {
      const res = classifyErrorText(
        'ERROR: [youtube] 123: Unable to download API page: <urlopen error [Errno 54] Connection reset by peer>'
      );
      expect(res.isNetworkError).toBe(true);
      expect(res.classification).toContain('ECONNRESET');
      expect(res.classification).toContain('Errno 54');
      expect(res.hint).toContain('VPN/прокси');
    });

    it('classifies Windows 10054 connection reset correctly', () => {
      const res = classifyErrorText(
        'urllib.error.URLError: <urlopen error [WinError 10054] An existing connection was forcibly closed by the remote host>'
      );
      expect(res.isNetworkError).toBe(true);
      expect(res.classification).toContain('WinError 10054');
    });

    it('classifies connection timeout (Errno 60 and ETIMEDOUT)', () => {
      const res = classifyErrorText(
        'ERROR: [soundcloud] test: Unable to download webpage: <urlopen error timed out>'
      );
      expect(res.isNetworkError).toBe(true);
      expect(res.classification).toContain('ETIMEDOUT');
      expect(res.classification).toContain('Errno 60');
    });

    it('classifies DNS resolution failures (getaddrinfo and Errno 8 / 11001)', () => {
      const res = classifyErrorText(
        'ERROR: [youtube] Unable to download webpage: [Errno 11001] getaddrinfo failed'
      );
      expect(res.isNetworkError).toBe(true);
      expect(res.classification).toContain('DNS');
      expect(res.classification).toContain('getaddrinfo');
    });

    it('classifies connection refused (ECONNREFUSED / Errno 61)', () => {
      const res = classifyErrorText(
        'urllib.error.URLError: <urlopen error [Errno 61] Connection refused>'
      );
      expect(res.isNetworkError).toBe(true);
      expect(res.classification).toContain('ECONNREFUSED');
    });

    it('classifies network unreachable (ENETUNREACH / no route to host)', () => {
      const res = classifyErrorText('urllib.error.URLError: <urlopen error [Errno 65] No route to host>');
      expect(res.isNetworkError).toBe(true);
      expect(res.classification).toContain('ENETUNREACH');
    });

    it('classifies TLS/SSL handshake failure', () => {
      const res = classifyErrorText(
        'ERROR: [youtube] certificate verify failed: certificate has expired (_ssl.c:1129)'
      );
      expect(res.isNetworkError).toBe(true);
      expect(res.classification).toContain('TLS/SSL');
    });

    it('classifies HTTP 403 Forbidden', () => {
      const res = classifyErrorText('ERROR: [youtube] HTTP Error 403: Forbidden');
      expect(res.isNetworkError).toBe(false);
      expect(res.classification).toContain('403 Forbidden');
    });

    it('classifies HTTP 429 Too Many Requests', () => {
      const res = classifyErrorText('ERROR: [youtube] HTTP Error 429: Too Many Requests');
      expect(res.isNetworkError).toBe(false);
      expect(res.classification).toContain('429 Too Many Requests');
    });

    it('classifies bot detection and captcha requirements', () => {
      const res = classifyErrorText(
        'ERROR: [youtube] Sign in to confirm you’re not a bot. This helps protect our community.'
      );
      expect(res.isNetworkError).toBe(false);
      expect(res.classification).toContain('Защита от ботов');
    });

    it('classifies private/unavailable video', () => {
      const res = classifyErrorText('ERROR: [youtube] Private video. Sign in if you have been granted access');
      expect(res.isNetworkError).toBe(false);
      expect(res.classification).toContain('Медиафайл недоступен');
    });

    it('classifies unsupported URLs', () => {
      const res = classifyErrorText('ERROR: Unsupported URL: https://example.com/not-media');
      expect(res.isNetworkError).toBe(false);
      expect(res.classification).toContain('Неподдерживаемый URL');
    });

    it('classifies HTTP 404 Not Found', () => {
      const res = classifyErrorText('ERROR: [youtube] 123: HTTP Error 404: Not Found');
      expect(res.isNetworkError).toBe(false);
      expect(res.classification).toContain('404 Not Found');
      expect(res.hint).toContain('удалены');
    });

    it('classifies HTTP 5xx Server Errors', () => {
      const res = classifyErrorText('ERROR: [youtube] HTTP Error 502: Bad Gateway');
      expect(res.isNetworkError).toBe(true);
      expect(res.classification).toContain('HTTP 5xx');
    });

    it('classifies FFmpeg and postprocessing errors', () => {
      const res = classifyErrorText('ERROR: Postprocessing: ffprobe and ffmpeg not found. Please install');
      expect(res.isNetworkError).toBe(false);
      expect(res.classification).toContain('FFmpeg');
      expect(res.hint).toContain('FFmpeg');
    });

    it('classifies paid/members-only content', () => {
      const res = classifyErrorText('ERROR: [youtube] Join this channel to get access to members-only content');
      expect(res.isNetworkError).toBe(false);
      expect(res.classification).toContain('Платный');
    });

    it('classifies extractor and JS player failures', () => {
      const res = classifyErrorText('ERROR: [youtube] Unable to extract yt initial data');
      expect(res.isNetworkError).toBe(false);
      expect(res.classification).toContain('экстрактора');
    });

    it('handles empty input gracefully', () => {
      const res = classifyErrorText('');
      expect(res.isNetworkError).toBe(false);
      expect(res.classification).toBeNull();
      expect(res.hint).toBeNull();
    });
  });

  describe('parseTechnicalDetails', () => {
    it('preserves a structured TechnicalDetails object without alteration', () => {
      const input: TechnicalDetails = {
        timestamp: '2026-10-30T12:00:00Z',
        url: 'https://youtube.com/watch?v=123',
        command: '"/path/to/yt-dlp" -J "https://youtube.com/watch?v=123"',
        executable: '/path/to/yt-dlp',
        arguments: ['-J', 'https://youtube.com/watch?v=123'],
        exit_code: 1,
        status: 'yt-dlp format discovery failed with status: exit status: 1',
        error_classification: 'Сброс соединения (ECONNRESET)',
        stdout: null,
        stderr: 'ERROR: Connection reset by peer',
        os: 'macos',
        arch: 'arm64',
        is_network_error: true,
        hint: 'Проверьте интернет-соединение или включите VPN',
        environment: ['Proxy: Direct'],
      };

      const parsed = parseTechnicalDetails(input);
      expect(parsed.timestamp).toBe('2026-10-30T12:00:00Z');
      expect(parsed.url).toBe('https://youtube.com/watch?v=123');
      expect(parsed.exit_code).toBe(1);
      expect(parsed.executable).toBe('/path/to/yt-dlp');
      expect(parsed.is_network_error).toBe(true);
      expect(parsed.stderr).toBe('ERROR: Connection reset by peer');
    });

    it('parses JSON string serialized from TechnicalDetails', () => {
      const obj = {
        timestamp: '2026-10-30T12:05:00Z',
        url: 'https://soundcloud.com/artist/track',
        command: 'yt-dlp -J https://soundcloud.com/artist/track',
        executable: 'yt-dlp',
        exit_code: 1,
        status: 'Exit status: 1',
        stderr: 'ERROR: [Errno 54] Connection reset by peer',
        os: 'windows',
        arch: 'x64',
        is_network_error: true,
      };

      const parsed = parseTechnicalDetails(JSON.stringify(obj));
      expect(parsed.url).toBe('https://soundcloud.com/artist/track');
      expect(parsed.is_network_error).toBe(true);
      expect(parsed.stderr).toContain('Connection reset by peer');
    });

    it('synthesizes complete TechnicalDetails from a raw error string', () => {
      const rawError = 'ERROR: [youtube] dQw4w9WgXcQ: Unable to download webpage: <urlopen error [Errno 54] Connection reset by peer>';
      const parsed = parseTechnicalDetails(rawError, 'https://youtube.com/watch?v=dQw4w9WgXcQ');

      expect(parsed.url).toBe('https://youtube.com/watch?v=dQw4w9WgXcQ');
      expect(parsed.command).toContain('https://youtube.com/watch?v=dQw4w9WgXcQ');
      expect(parsed.executable).toBe('yt-dlp');
      expect(parsed.stderr).toBe(rawError);
      expect(parsed.is_network_error).toBe(true);
      expect(parsed.error_classification).toContain('ECONNRESET');
      expect(parsed.timestamp).toBeDefined();
    });

    it('synthesizes TechnicalDetails from JavaScript Error instance', () => {
      const err = new Error('getaddrinfo failed: domain not found');
      const parsed = parseTechnicalDetails(err, 'https://example.com/video');

      expect(parsed.url).toBe('https://example.com/video');
      expect(parsed.status).toBe('getaddrinfo failed: domain not found');
      expect(parsed.is_network_error).toBe(true);
      expect(parsed.error_classification).toContain('DNS');
    });

    it('unwraps nested details property from event payloads without mangling', () => {
      const payload = {
        job_id: 'download-123',
        url: 'https://youtube.com/watch?v=nested',
        error: 'Process failed',
        details: {
          timestamp: '2026-10-30T10:00:00Z',
          url: 'https://youtube.com/watch?v=nested',
          command: 'yt-dlp "https://youtube.com/watch?v=nested"',
          executable: 'yt-dlp',
          exit_code: 1,
          status: 'Process failed',
          stderr: 'ERROR: [youtube] nested: Video unavailable',
          os: 'macos',
          arch: 'arm64',
          is_network_error: false,
        },
      };

      const parsed = parseTechnicalDetails(payload);
      expect(parsed.url).toBe('https://youtube.com/watch?v=nested');
      expect(parsed.exit_code).toBe(1);
      expect(parsed.stderr).toBe('ERROR: [youtube] nested: Video unavailable');
      expect(parsed.status).not.toBe('[object Object]');
    });

    it('handles generic objects with error string without producing [object Object]', () => {
      const errorObj = {
        error: 'WinError 10060: connection timed out',
        code: 1,
      };

      const parsed = parseTechnicalDetails(errorObj, 'https://example.com/item');
      expect(parsed.url).toBe('https://example.com/item');
      expect(parsed.status).toBe('WinError 10060: connection timed out');
      expect(parsed.status).not.toContain('[object Object]');
      expect(parsed.stderr).not.toContain('[object Object]');
      expect(parsed.is_network_error).toBe(true);
      expect(parsed.exit_code).toBe(1);
    });

    it('handles generic objects with message string without producing [object Object]', () => {
      const messageObj = {
        message: 'Postprocessing: ffprobe and ffmpeg not found',
      };

      const parsed = parseTechnicalDetails(messageObj);
      expect(parsed.status).toBe('Postprocessing: ffprobe and ffmpeg not found');
      expect(parsed.error_classification).toContain('FFmpeg');
      expect(parsed.status).not.toContain('[object Object]');
    });
  });

  describe('formatDiagnosticReport', () => {
    it('formats a complete markdown diagnostic report with all required sections', () => {
      const details: TechnicalDetails = {
        timestamp: '2026-10-30T13:00:00Z',
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
        command: '"/Users/test/yt-dlp" -J --force-ipv4 "https://youtube.com/watch?v=dQw4w9WgXcQ"',
        executable: '/Users/test/yt-dlp',
        arguments: ['-J', '--force-ipv4', 'https://youtube.com/watch?v=dQw4w9WgXcQ'],
        exit_code: 1,
        status: 'yt-dlp process exited with status: exit status: 1',
        error_classification: 'Сброс соединения (ECONNRESET / Errno 54)',
        stdout: '{"some":"stdout"}',
        stderr: 'ERROR: [Errno 54] Connection reset by peer',
        os: 'macos',
        arch: 'arm64',
        is_network_error: true,
        hint: 'Проверьте интернет-соединение или включите VPN/прокси.',
        environment: ['Proxy: None configured'],
      };

      const report = formatDiagnosticReport(details);

      expect(report).toContain('==================== SZ_DOWNLOAD_DIAGNOSTICS ====================');
      expect(report).toContain('Timestamp:      2026-10-30T13:00:00Z');
      expect(report).toContain('URL:            https://youtube.com/watch?v=dQw4w9WgXcQ');
      expect(report).toContain('Platform:       macos (arm64)');
      expect(report).toContain('Exit Code:      1');
      expect(report).toContain('Classification: Сброс соединения (ECONNRESET / Errno 54)');
      expect(report).toContain('Network Error:  YES');
      expect(report).toContain('Recommendation: Проверьте интернет-соединение или включите VPN/прокси.');
      expect(report).toContain('Executable: /Users/test/yt-dlp');
      expect(report).toContain('Command:    "/Users/test/yt-dlp" -J --force-ipv4 "https://youtube.com/watch?v=dQw4w9WgXcQ"');
      expect(report).toContain('--- ENVIRONMENT ---');
      expect(report).toContain('Proxy: None configured');
      expect(report).toContain('--- STDERR ---');
      expect(report).toContain('ERROR: [Errno 54] Connection reset by peer');
      expect(report).toContain('--- STDOUT ---');
      expect(report).toContain('{"some":"stdout"}');
    });
  });

  describe('copyTextToClipboard', () => {
    const originalClipboard = navigator.clipboard;

    afterEach(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        writable: true,
      });
      vi.restoreAllMocks();
    });

    it('copies using navigator.clipboard when available', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        writable: true,
      });

      const success = await copyTextToClipboard('test report');
      expect(success).toBe(true);
      expect(writeTextMock).toHaveBeenCalledWith('test report');
    });

    it('falls back to document.execCommand when navigator.clipboard fails', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) },
        writable: true,
      });

      const mockTextArea = {
        value: '',
        style: {} as any,
        setAttribute: vi.fn(),
        focus: vi.fn(),
        select: vi.fn(),
      };

      const mockDoc = {
        createElement: vi.fn().mockReturnValue(mockTextArea),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
        execCommand: vi.fn().mockReturnValue(true),
      };

      const originalDoc = (globalThis as any).document;
      (globalThis as any).document = mockDoc;

      try {
        const success = await copyTextToClipboard('fallback report');
        expect(success).toBe(true);
        expect(mockDoc.execCommand).toHaveBeenCalledWith('copy');
        expect(mockTextArea.value).toBe('fallback report');
      } finally {
        (globalThis as any).document = originalDoc;
      }
    });

    it('returns false for empty text', async () => {
      const success = await copyTextToClipboard('');
      expect(success).toBe(false);
    });
  });
});
