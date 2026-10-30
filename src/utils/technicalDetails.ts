import { TechnicalDetails } from '../types/technicalDetails';
import { isNetworkErrorText } from './downloadHelpers';

export interface ErrorClassificationResult {
  isNetworkError: boolean;
  classification: string | null;
  hint: string | null;
}

export const classifyErrorText = (errText: string): ErrorClassificationResult => {
  if (!errText) {
    return {
      isNetworkError: false,
      classification: null,
      hint: null,
    };
  }

  const lower = errText.toLowerCase();

  // 1. Connection Reset / ECONNRESET
  if (
    lower.includes('errno 54') ||
    lower.includes('10054') ||
    lower.includes('connection reset') ||
    lower.includes('remotedisconnected') ||
    lower.includes('remote end closed')
  ) {
    return {
      isNetworkError: true,
      classification:
        'Сброс соединения (ECONNRESET / Errno 54 / WinError 10054). Сетевой поток разорван сервером или блокировкой провайдером (РКН / DPI / фаервол).',
      hint: 'Проверьте интернет-соединение или включите VPN/прокси (возможно, ресурс заблокирован в вашем регионе).',
    };
  }

  // 2. Timeout
  if (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('timedout') ||
    lower.includes('errno 60') ||
    lower.includes('winerror 10060') ||
    lower.includes('таймаут')
  ) {
    return {
      isNetworkError: true,
      classification:
        'Таймаут подключения (ETIMEDOUT / Errno 60 / WinError 10060). Сервер не ответил в отведенное время; возможна потеря пакетов или замедление/блокировка DPI.',
      hint: 'Проверьте интернет-соединение или включите VPN/прокси, если сервис заблокирован или замедлен.',
    };
  }

  // 3. DNS Lookup Failure
  if (
    lower.includes('getaddrinfo') ||
    lower.includes('nodename nor servname') ||
    lower.includes('name or service not known') ||
    lower.includes('temporary failure in name resolution') ||
    lower.includes('errno 8') ||
    lower.includes('errno 11001')
  ) {
    return {
      isNetworkError: true,
      classification:
        'Ошибка разрешения DNS (getaddrinfo / Errno 8 / 11001). Не удалось определить IP-адрес сервера по доменному имени.',
      hint: 'Проверьте настройки DNS-сервера или интернет-подключение.',
    };
  }

  // 4. Connection Refused
  if (
    lower.includes('connection refused') ||
    lower.includes('winerror 10061') ||
    lower.includes('errno 61')
  ) {
    return {
      isNetworkError: true,
      classification:
        'Соединение отклонено (ECONNREFUSED / Errno 61). Удаленный сервер или локальный прокси отклонил попытку подключения.',
      hint: 'Убедитесь, что сервис доступен и на компьютере не включен некорректно настроенный локальный прокси.',
    };
  }

  // 5. Network / Host Unreachable
  if (
    lower.includes('network is unreachable') ||
    lower.includes('network is down') ||
    lower.includes('no route to host') ||
    lower.includes('winerror 10051') ||
    lower.includes('errno 65')
  ) {
    return {
      isNetworkError: true,
      classification:
        'Сеть недоступна (ENETUNREACH / EHOSTUNREACH). Отсутствует сетевой маршрут к адресу либо отключен интернет.',
      hint: 'Проверьте статус интернет-подключения и маршрутизацию.',
    };
  }

  // 6. TLS / SSL Failure
  if (
    lower.includes('certificate verify failed') ||
    lower.includes('ssl error') ||
    lower.includes('tls error') ||
    lower.includes('sslv3') ||
    lower.includes('handshake_failure')
  ) {
    return {
      isNetworkError: true,
      classification:
        'Сбой TLS/SSL рукопожатия. Ошибка проверки сертификата или перехват зашифрованного HTTPS трафика.',
      hint: 'Возможен конфликт с антивирусным сканером HTTPS или MITM-прокси/сертификатом провайдера.',
    };
  }

  // 7. HTTP 403 Forbidden
  if (lower.includes('http error 403') || lower.includes('403 forbidden')) {
    return {
      isNetworkError: false,
      classification:
        'HTTP 403 Forbidden. Доступ к медиа запрещен сервером (гео-блокировка, приватное видео или устаревший токен).',
      hint: 'Попробуйте сменить регион через VPN или открыть ссылку в браузере, чтобы проверить доступность.',
    };
  }

  // 8. HTTP 429 Too Many Requests
  if (lower.includes('http error 429') || lower.includes('too many requests')) {
    return {
      isNetworkError: false,
      classification:
        'HTTP 429 Too Many Requests. Превышен лимит запросов к серверу платформы (Rate Limiting).',
      hint: 'Слишком много запросов за короткое время. Подождите несколько минут или смените IP-адрес/VPN.',
    };
  }

  // 9. Bot detection / Captcha
  if (
    lower.includes('sign in to confirm') ||
    lower.includes('confirm you') ||
    lower.includes('bot') ||
    lower.includes('captcha')
  ) {
    return {
      isNetworkError: false,
      classification:
        'Защита от ботов / Требуется вход. Сервис заблокировал автоматический запрос и требует авторизацию.',
      hint: 'Сервис требует подтвердить, что вы человек, или войти в аккаунт.',
    };
  }

  // 10. Private / Unavailable video
  if (
    lower.includes('video unavailable') ||
    lower.includes('private video') ||
    lower.includes('this video has been removed')
  ) {
    return {
      isNetworkError: false,
      classification:
        'Медиафайл недоступен. Видео удалено автором, скрыто настройками приватности или заблокировано по жалобе.',
      hint: 'Проверьте доступность видео в обычном браузере.',
    };
  }

  // 11. Unsupported URL
  if (lower.includes('unsupported url')) {
    return {
      isNetworkError: false,
      classification:
        'Неподдерживаемый URL. yt-dlp не имеет модуля для скачивания с этого адреса.',
      hint: 'Убедитесь, что ссылка ведет на конкретную страницу с видео/аудио.',
    };
  }

  // 12. HTTP 404 Not Found
  if (lower.includes('http error 404') || lower.includes('404: not found') || lower.includes('404 not found')) {
    return {
      isNetworkError: false,
      classification:
        'HTTP 404 Not Found. Запрашиваемая страница или медиафайл не найдены на сервере платформы.',
      hint: 'Проверьте правильность ссылки, возможно видео или страница были удалены.',
    };
  }

  // 13. HTTP 5xx Server Errors
  if (
    lower.includes('http error 500') ||
    lower.includes('http error 502') ||
    lower.includes('http error 503') ||
    lower.includes('http error 504') ||
    lower.includes('502 bad gateway') ||
    lower.includes('503 service unavailable') ||
    lower.includes('504 gateway time-out') ||
    lower.includes('gateway timeout')
  ) {
    return {
      isNetworkError: true,
      classification:
        'Сбой сервера платформы (HTTP 5xx / Bad Gateway / Service Unavailable). Сервер источника перегружен или временно недоступен.',
      hint: 'Проблема на стороне видеохостинга. Попробуйте повторить попытку через несколько минут.',
    };
  }

  // 14. FFmpeg / Postprocessor Error
  if (
    lower.includes('ffprobe and ffmpeg not found') ||
    lower.includes('ffmpeg not found') ||
    lower.includes('ffprobe not found') ||
    lower.includes('postprocessing: error opening output') ||
    lower.includes('please install or provide the path to a working ffmpeg')
  ) {
    return {
      isNetworkError: false,
      classification:
        'Ошибка постобработки / Отсутствует FFmpeg. yt-dlp не смог объединить видео и аудио или сконвертировать файл.',
      hint: 'Убедитесь, что в системе установлен FFmpeg или укажите путь к нему в настройках приложения.',
    };
  }

  // 15. Members-only / Premium / DRM
  if (
    lower.includes('join this channel to get access') ||
    lower.includes('members-only') ||
    lower.includes('music premium members') ||
    lower.includes('drm protected') ||
    lower.includes('this video is drm protected')
  ) {
    return {
      isNetworkError: false,
      classification:
        'Платный или защищенный DRM контент. Видео доступно только спонсорам канала, подписчикам Premium или защищено DRM-шифрованием.',
      hint: 'Этот контент требует платной авторизации или защищен DRM, поэтому его невозможно скачать напрямую.',
    };
  }

  // 16. Extractor / JS Player Failure
  if (
    lower.includes('unable to extract yt initial data') ||
    lower.includes('unable to extract video data') ||
    lower.includes('unable to extract js player') ||
    lower.includes('extractor error')
  ) {
    return {
      isNetworkError: false,
      classification:
        'Сбой экстрактора yt-dlp. Изменились внутренние алгоритмы платформы видеохостинга.',
      hint: 'Возможно, видеохостинг обновил плеер. Обновите yt-dlp в настройках или повторите попытку позже.',
    };
  }

  const isNet = isNetworkErrorText(errText);
  return {
    isNetworkError: isNet,
    classification: isNet ? 'Сетевая ошибка при обращении к серверу' : null,
    hint: isNet
      ? 'Проверьте интернет-соединение или включите VPN/прокси (возможно, ресурс заблокирован в вашем регионе).'
      : null,
  };
};

const detectPlatformInfo = (): { os: string; arch: string } => {
  if (typeof navigator === 'undefined') {
    return { os: 'unknown', arch: 'unknown' };
  }

  const ua = navigator.userAgent || '';
  let os = 'unknown';
  if (/Macintosh|Mac OS X/i.test(ua)) os = 'macos';
  else if (/Windows/i.test(ua)) os = 'windows';
  else if (/Linux/i.test(ua)) os = 'linux';

  let arch = 'unknown';
  if (/arm64|aarch64/i.test(ua)) arch = 'arm64';
  else if (/x86_64|win64|x64|wow64/i.test(ua)) arch = 'x64';

  return { os, arch };
};

export const parseTechnicalDetails = (
  raw: unknown,
  fallbackUrl: string = ''
): TechnicalDetails => {
  // Case 1: Already an object matching TechnicalDetails
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, any>;

    // If wrapped in a .details property (e.g. DownloadErrorPayload or ApiResponse)
    if (obj.details && typeof obj.details === 'object') {
      return parseTechnicalDetails(obj.details, obj.url ? String(obj.url) : fallbackUrl);
    }

    if (obj.timestamp && (obj.url || obj.command || obj.status)) {
      const platform = detectPlatformInfo();
      const combined = `${obj.status || ''}\n${obj.stderr || ''}\n${obj.stdout || ''}`;
      const detected = classifyErrorText(combined);

      return {
        timestamp: String(obj.timestamp),
        url: String(obj.url || fallbackUrl || ''),
        command: String(obj.command || `yt-dlp "${obj.url || fallbackUrl || ''}"`),
        executable: String(obj.executable || 'yt-dlp'),
        arguments: Array.isArray(obj.arguments) ? obj.arguments.map(String) : undefined,
        exit_code: typeof obj.exit_code === 'number' ? obj.exit_code : null,
        status: String(obj.status || 'Error'),
        error_classification: obj.error_classification || detected.classification,
        stdout: obj.stdout ? String(obj.stdout) : null,
        stderr: obj.stderr ? String(obj.stderr) : null,
        os: String(obj.os || platform.os),
        arch: String(obj.arch || platform.arch),
        is_network_error: typeof obj.is_network_error === 'boolean' ? obj.is_network_error : detected.isNetworkError,
        hint: obj.hint || detected.hint,
        environment: Array.isArray(obj.environment) ? obj.environment.map(String) : undefined,
      };
    }

    // Generic object without timestamp (e.g. { error: "...", message: "..." })
    const url = String(obj.url || fallbackUrl || '');
    const stderr = obj.stderr ? String(obj.stderr) : (obj.error ? String(obj.error) : null);
    const stdout = obj.stdout ? String(obj.stdout) : null;
    const status = String(obj.status || obj.message || obj.error || (stderr ? stderr.split('\n')[0] : 'Execution error'));
    const exit_code = typeof obj.exit_code === 'number' ? obj.exit_code : (typeof obj.code === 'number' ? obj.code : null);
    const combined = `${status}\n${stderr || ''}\n${stdout || ''}`;
    const detected = classifyErrorText(combined);
    const platform = detectPlatformInfo();

    return {
      timestamp: new Date().toISOString(),
      url,
      command: obj.command ? String(obj.command) : (url ? `yt-dlp "${url}"` : 'yt-dlp'),
      executable: obj.executable ? String(obj.executable) : 'yt-dlp',
      arguments: Array.isArray(obj.arguments) ? obj.arguments.map(String) : (url ? ['-J', url] : []),
      exit_code,
      status,
      error_classification: obj.error_classification || detected.classification,
      stdout,
      stderr: stderr || (status !== 'Execution error' ? status : null),
      os: String(obj.os || platform.os),
      arch: String(obj.arch || platform.arch),
      is_network_error: typeof obj.is_network_error === 'boolean' ? obj.is_network_error : detected.isNetworkError,
      hint: obj.hint || detected.hint,
      environment: Array.isArray(obj.environment) ? obj.environment.map(String) : undefined,
    };
  }

  // Case 2: String - check if it's JSON
  let text = '';
  if (typeof raw === 'string') {
    text = raw.trim();
    if (text.startsWith('{') && text.endsWith('}')) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          return parseTechnicalDetails(parsed, fallbackUrl);
        }
      } catch {
        // Not valid JSON, proceed as plain string
      }
    }
  } else if (raw instanceof Error) {
    text = raw.message || raw.toString();
  } else if (raw !== null && raw !== undefined) {
    text = String(raw);
  }

  const platform = detectPlatformInfo();
  const detected = classifyErrorText(text);
  const firstLine = text.split('\n')[0] || 'Unknown error';

  return {
    timestamp: new Date().toISOString(),
    url: fallbackUrl || '',
    command: fallbackUrl ? `yt-dlp "${fallbackUrl}"` : 'yt-dlp',
    executable: 'yt-dlp',
    arguments: fallbackUrl ? ['-J', fallbackUrl] : [],
    exit_code: null,
    status: firstLine,
    error_classification: detected.classification,
    stdout: null,
    stderr: text || null,
    os: platform.os,
    arch: platform.arch,
    is_network_error: detected.isNetworkError,
    hint: detected.hint,
  };
};

export const formatDiagnosticReport = (details: TechnicalDetails): string => {
  const lines: string[] = [];
  lines.push('==================== SZ_DOWNLOAD_DIAGNOSTICS ====================');
  lines.push(`Timestamp:      ${details.timestamp}`);
  lines.push(`URL:            ${details.url || '—'}`);
  lines.push(`Platform:       ${details.os} (${details.arch})`);
  lines.push(`Status:         ${details.status}`);
  lines.push(`Exit Code:      ${details.exit_code !== null && details.exit_code !== undefined ? details.exit_code : 'N/A'}`);
  lines.push(`Classification: ${details.error_classification || 'Standard execution error'}`);
  lines.push(`Network Error:  ${details.is_network_error ? 'YES' : 'NO'}`);

  if (details.hint) {
    lines.push(`Recommendation: ${details.hint}`);
  }

  lines.push('');
  lines.push('--- EXECUTABLE & COMMAND ---');
  lines.push(`Executable: ${details.executable}`);
  lines.push(`Command:    ${details.command}`);

  if (details.arguments && details.arguments.length > 0) {
    lines.push(`Arguments:  ${JSON.stringify(details.arguments)}`);
  }

  if (details.environment && details.environment.length > 0) {
    lines.push('');
    lines.push('--- ENVIRONMENT ---');
    details.environment.forEach((env) => lines.push(env));
  }

  lines.push('');
  lines.push('--- STDERR ---');
  lines.push(details.stderr?.trim() || '(empty)');

  lines.push('');
  lines.push('--- STDOUT ---');
  lines.push(details.stdout?.trim() || '(empty)');

  lines.push('================================================================');

  return lines.join('\n');
};

export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (!text) return false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('[TechnicalDetails] navigator.clipboard.writeText failed, trying fallback:', err);
  }

  try {
    if (typeof document !== 'undefined') {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      textArea.setAttribute('readonly', '');
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    }
  } catch (err) {
    console.error('[TechnicalDetails] document.execCommand fallback failed:', err);
  }

  return false;
};
