export interface BaseDownloadFormatOption {
  label: string;
  quality: string;
  format: string;
  ext: string;
  height?: number | null;
  filesize?: number | null;
  is_audio_only: boolean;
}

export const normalizeInputUrl = (raw: string): string => {
  let trimmed = raw.trim();
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed) && /^[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+(\/|\?|$)/.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  return trimmed;
};

export const isValidMediaUrl = (url: string): boolean => {
  const trimmed = url.trim();
  if (!trimmed) return false;
  return /^https?:\/\/[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/i.test(trimmed);
};

export const isNetworkErrorText = (errStr: string): boolean => {
  if (!errStr) return false;
  return /timed out|timeout|timedout|getaddrinfo|urlopen error|connection refused|connection reset|network is unreachable|network is down|no route to host|temporary failure in name resolution|nodename nor servname|name or service not known|remote end closed|remotedisconnected|certificate verify failed|ssl error|tls error|http error 403|http error 429|winerror 10060|winerror 10054|winerror 10051|errno 60|errno 8|блокировк|таймаут|сбой сети/i.test(
    errStr
  );
};

export const formatDownloadBytes = (bytes?: number | null): string => {
  if (!bytes || bytes <= 0) {
    return '';
  }

  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

export const formatDownloadHeight = (height?: number | null): string => {
  if (!height) {
    return 'Best';
  }
  return `${height}p`;
};

export const formatDownloadOptionLabel = (item: {
  label: string;
  height?: number | null;
  filesize?: number | null;
}): string => {
  const parts: string[] = [item.label];
  if (item.height && !item.label.toLowerCase().includes(`${item.height}p`)) {
    parts.push(formatDownloadHeight(item.height));
  }
  if (item.filesize && item.filesize > 0) {
    const sizeStr = formatDownloadBytes(item.filesize);
    if (sizeStr) {
      parts.push(sizeStr);
    }
  }
  return parts.join(' • ');
};

export const normalizeDownloadFormats = <
  T extends BaseDownloadFormatOption,
  D extends BaseDownloadFormatOption = BaseDownloadFormatOption
>(
  formats: T[],
  defaultFormats: D[]
): (T | D)[] => {
  const merged: (T | D)[] = [...formats];
  const isAudioOnlySource = merged.length > 0 && merged.every((item) => item.is_audio_only);

  if (!isAudioOnlySource && !merged.some((item) => item.format === 'mp4')) {
    if (defaultFormats[0]) {
      merged.unshift(defaultFormats[0]);
    }
  }

  if (!merged.some((item) => item.format === 'mp3')) {
    if (defaultFormats[1]) {
      merged.push(defaultFormats[1]);
    }
  }

  return merged;
};
