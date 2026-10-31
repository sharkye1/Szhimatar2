import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { TechnicalDetailsViewer } from '../TechnicalDetailsViewer';
import { TechnicalDetails } from '../../types/technicalDetails';

describe('TechnicalDetailsViewer Component', () => {
  const dummyTheme = {
    colors: {
      text: '#ffffff',
      textSecondary: '#a1a1aa',
      primary: '#3b82f6',
      warning: '#eab308',
      error: '#ef4444',
      success: '#22c55e',
      surface: '#18181b',
      border: 'rgba(255, 255, 255, 0.1)',
    },
  };

  const dummyT = (key: string): string => {
    const map: Record<string, string> = {
      'download.technicalDetails': 'Технические подробности',
      'download.copyDiagnostics': 'Скопировать отчет',
      'download.copiedDiagnostics': 'Скопировано!',
      'download.copyDiagnosticsTooltip': 'Скопировать полный отчет об ошибке',
      'download.classificationLabel': 'Классификация ошибки',
      'download.timestampLabel': 'Время',
      'download.platformLabel': 'Платформа',
      'download.statusLabel': 'Статус',
      'download.executableLabel': 'Исполняемый файл',
      'download.envLabel': 'Сетевое окружение',
      'download.command': 'Выполненная команда',
      'download.stderrLabel': 'Лог ошибок (stderr)',
      'download.stdoutLabel': 'Вывод команды (stdout)',
      'download.tabSummary': 'Сводка',
      'download.tabStderr': 'Лог (stderr)',
      'download.tabCommand': 'Команда',
      'download.tabStdout': 'Вывод (stdout)',
      'download.tabAll': 'Все разделы',
      'download.expandModal': 'В окне',
      'download.closeModal': 'Закрыть',
    };
    return map[key] || key;
  };

  const sampleDetails: TechnicalDetails = {
    timestamp: '2026-10-31 12:00:00',
    url: 'https://youtube.com/watch?v=test1234',
    command: 'yt-dlp --dump-json "https://youtube.com/watch?v=test1234"',
    executable: '/usr/local/bin/yt-dlp',
    exit_code: 1,
    status: 'ERROR: Connection timed out',
    error_classification: 'Таймаут подключения (ETIMEDOUT / Errno 60)',
    stdout: '[youtube] Extracting URL',
    stderr: 'ERROR: [youtube] test1234: Unable to download webpage: <urlopen error timed out>\nTraceback line 2\nTraceback line 3',
    os: 'macos',
    arch: 'arm64',
    is_network_error: true,
    hint: 'Проверьте соединение или включите VPN/прокси.',
    environment: ['HTTP_PROXY: not set', 'DNS: 8.8.8.8'],
  };

  it('returns null when details is not provided', () => {
    const html = renderToString(
      React.createElement(TechnicalDetailsViewer, {
        details: null as any,
        theme: dummyTheme,
        t: dummyT,
      })
    );
    expect(html).toBe('');
  });

  it('renders summary title, network error badge, and exit code badge', () => {
    const html = renderToString(
      React.createElement(TechnicalDetailsViewer, {
        details: sampleDetails,
        theme: dummyTheme,
        t: dummyT,
        defaultOpen: false,
      })
    );
    expect(html).toContain('Технические подробности');
    expect(html).toContain('Сбой сети');
    expect(html).toMatch(/Код.*1/);
  });

  it('renders bounded card with max-height and overflow constraint when opened', () => {
    const html = renderToString(
      React.createElement(TechnicalDetailsViewer, {
        details: sampleDetails,
        theme: dummyTheme,
        t: dummyT,
        defaultOpen: true,
      })
    );
    expect(html).toContain('technical-details-card');
    expect(html).toContain('max-height:min(310px, 38vh)');
    expect(html).toContain('overflow:hidden');
  });

  it('renders tab buttons including stderr count and dialog maximize button', () => {
    const html = renderToString(
      React.createElement(TechnicalDetailsViewer, {
        details: sampleDetails,
        theme: dummyTheme,
        t: dummyT,
        defaultOpen: true,
      })
    );
    expect(html).toContain('Сводка');
    expect(html).toContain('Лог (stderr)');
    expect(html).toContain('Команда');
    expect(html).toContain('Вывод (stdout)');
    expect(html).toContain('Все разделы');
    // Stderr line count badge (3 lines)
    expect(html).toContain('>3</span>');
    // Dialog maximize button
    expect(html).toContain('В окне');
    expect(html).toContain('Скопировать отчет');
  });

  it('renders summary tab content by default (classification, url, hint)', () => {
    const html = renderToString(
      React.createElement(TechnicalDetailsViewer, {
        details: sampleDetails,
        theme: dummyTheme,
        t: dummyT,
        defaultOpen: true,
        initialTab: 'summary',
      })
    );
    expect(html).toContain('Классификация ошибки');
    expect(html).toContain('Таймаут подключения (ETIMEDOUT / Errno 60)');
    expect(html).toContain('https://youtube.com/watch?v=test1234');
    expect(html).toContain('Проверьте соединение или включите VPN/прокси.');
  });

  it('renders stderr tab content when selected', () => {
    const html = renderToString(
      React.createElement(TechnicalDetailsViewer, {
        details: sampleDetails,
        theme: dummyTheme,
        t: dummyT,
        defaultOpen: true,
        initialTab: 'stderr',
      })
    );
    expect(html).toContain('Лог ошибок (stderr)');
    expect(html).toContain('Unable to download webpage');
  });

  it('renders command tab content when selected', () => {
    const html = renderToString(
      React.createElement(TechnicalDetailsViewer, {
        details: sampleDetails,
        theme: dummyTheme,
        t: dummyT,
        defaultOpen: true,
        initialTab: 'command',
      })
    );
    expect(html).toContain('Выполненная команда');
    expect(html).toContain('yt-dlp --dump-json');
  });

  it('renders all sections when tab is set to all', () => {
    const html = renderToString(
      React.createElement(TechnicalDetailsViewer, {
        details: sampleDetails,
        theme: dummyTheme,
        t: dummyT,
        defaultOpen: true,
        initialTab: 'all',
      })
    );
    expect(html).toContain('Классификация ошибки');
    expect(html).toContain('Выполненная команда');
    expect(html).toContain('Лог ошибок (stderr)');
    expect(html).toContain('Вывод команды (stdout)');
  });

  it('omits stdout and command tabs when those fields are empty', () => {
    const minimalDetails: TechnicalDetails = {
      timestamp: '2026-10-31 12:00:00',
      url: 'https://example.com/audio.mp3',
      command: '',
      executable: 'ffmpeg',
      status: 'Generic failure',
      stdout: '',
      stderr: 'Decoder error',
      os: 'macos',
      arch: 'x64',
      is_network_error: false,
    };

    const html = renderToString(
      React.createElement(TechnicalDetailsViewer, {
        details: minimalDetails,
        theme: dummyTheme,
        t: dummyT,
        defaultOpen: true,
      })
    );
    expect(html).not.toContain('Сбой сети');
    expect(html).not.toContain('Код ');
    expect(html).not.toContain('Вывод (stdout)');
    expect(html).toContain('Сводка');
    expect(html).toContain('Лог (stderr)');
  });
});
