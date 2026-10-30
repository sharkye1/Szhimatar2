import React, { useState, useRef, useEffect } from 'react';
import { Copy, Check, Terminal, AlertTriangle, Info, CheckCircle2, ChevronDown, FileText } from 'lucide-react';
import { TechnicalDetails } from '../types/technicalDetails';
import { formatDiagnosticReport, copyTextToClipboard } from '../utils/technicalDetails';

export interface TechnicalDetailsViewerProps {
  details: TechnicalDetails;
  theme: any;
  t: (key: string) => string;
  defaultOpen?: boolean;
}

export const TechnicalDetailsViewer: React.FC<TechnicalDetailsViewerProps> = ({
  details,
  theme,
  t,
  defaultOpen = false,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [copiedReport, setCopiedReport] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedStderr, setCopiedStderr] = useState(false);

  const reportTimerRef = useRef<number | null>(null);
  const cmdTimerRef = useRef<number | null>(null);
  const stderrTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
      if (cmdTimerRef.current) clearTimeout(cmdTimerRef.current);
      if (stderrTimerRef.current) clearTimeout(stderrTimerRef.current);
    };
  }, []);

  if (!details) {
    return null;
  }

  const handleCopyReport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const reportText = formatDiagnosticReport(details);
    const success = await copyTextToClipboard(reportText);
    if (success) {
      setCopiedReport(true);
      if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
      reportTimerRef.current = window.setTimeout(() => {
        setCopiedReport(false);
      }, 2500);
    }
  };

  const handleCopyCmd = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!details.command) return;
    const success = await copyTextToClipboard(details.command);
    if (success) {
      setCopiedCmd(true);
      if (cmdTimerRef.current) clearTimeout(cmdTimerRef.current);
      cmdTimerRef.current = window.setTimeout(() => {
        setCopiedCmd(false);
      }, 2000);
    }
  };

  const handleCopyStderr = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const textToCopy = details.stderr || details.status || '';
    if (!textToCopy) return;
    const success = await copyTextToClipboard(textToCopy);
    if (success) {
      setCopiedStderr(true);
      if (stderrTimerRef.current) clearTimeout(stderrTimerRef.current);
      stderrTimerRef.current = window.setTimeout(() => {
        setCopiedStderr(false);
      }, 2000);
    }
  };

  const copyBtnLabel = copiedReport
    ? (t('download.copiedDiagnostics') || 'Скопировано!')
    : (t('download.copyDiagnostics') || 'Скопировать диагностику');

  return (
    <details
      open={isOpen}
      onToggle={(e) => {
        setIsOpen(e.currentTarget.open);
      }}
      style={{
        fontSize: '0.74rem',
        color: theme.colors.textSecondary,
        width: '100%',
        marginTop: '6px',
        boxSizing: 'border-box',
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontWeight: 600,
          listStyle: 'none',
          padding: '4px 8px',
          borderRadius: '5px',
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.09)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.18)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        }}
      >
        <ChevronDown
          size={13}
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
            flexShrink: 0,
            opacity: 0.8,
          }}
        />
        <Terminal size={12} strokeWidth={2} style={{ flexShrink: 0 }} />
        <span>{t('download.technicalDetails') || 'Технические подробности'}</span>

        {details.is_network_error && (
          <span
            style={{
              marginLeft: '4px',
              fontSize: '0.68rem',
              padding: '1px 5px',
              borderRadius: '4px',
              background: 'rgba(234, 179, 8, 0.15)',
              color: theme.colors.warning || '#eab308',
              fontWeight: 500,
            }}
          >
            Сбой сети
          </span>
        )}

        {details.exit_code !== null && details.exit_code !== undefined && (
          <span
            style={{
              marginLeft: '2px',
              fontSize: '0.68rem',
              padding: '1px 5px',
              borderRadius: '4px',
              background: 'rgba(239, 68, 68, 0.15)',
              color: theme.colors.error || '#ef4444',
              fontWeight: 500,
            }}
          >
            Код {details.exit_code}
          </span>
        )}
      </summary>

      {/* Expanded diagnostic card */}
      <div
        style={{
          marginTop: '6px',
          padding: '10px 12px',
          background: 'rgba(0, 0, 0, 0.38)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '6px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {/* Top Action Bar inside technical details */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            paddingBottom: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                color: theme.colors.text,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                wordBreak: 'break-word',
              }}
            >
              {details.is_network_error ? (
                <AlertTriangle size={13} color={theme.colors.warning || '#eab308'} style={{ flexShrink: 0 }} />
              ) : (
                <Info size={13} color={theme.colors.primary || '#3b82f6'} style={{ flexShrink: 0 }} />
              )}
              {details.status}
            </span>
          </div>

          {/* Copy Report Button */}
          <button
            type="button"
            onClick={handleCopyReport}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 9px',
              fontSize: '0.72rem',
              fontWeight: 500,
              background: copiedReport ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.1)',
              border: copiedReport
                ? '1px solid rgba(34, 197, 94, 0.4)'
                : '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '5px',
              color: copiedReport ? (theme.colors.success || '#22c55e') : theme.colors.text,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'all 0.15s ease',
            }}
            title={t('download.copyDiagnosticsTooltip') || 'Скопировать полный отчет об ошибке в буфер обмена'}
          >
            {copiedReport ? (
              <CheckCircle2 size={13} strokeWidth={2.2} />
            ) : (
              <Copy size={13} strokeWidth={2} />
            )}
            <span>{copyBtnLabel}</span>
          </button>
        </div>

        {/* Classification highlight banner if classified */}
        {details.error_classification && (
          <div
            style={{
              background: 'rgba(234, 179, 8, 0.1)',
              border: '1px solid rgba(234, 179, 8, 0.25)',
              borderRadius: '5px',
              padding: '6px 8px',
              color: theme.colors.text,
              fontSize: '0.72rem',
              lineHeight: 1.35,
            }}
          >
            <div style={{ fontWeight: 600, color: theme.colors.warning || '#eab308', marginBottom: '2px' }}>
              {t('download.classificationLabel') || 'Классификация ошибки'}:
            </div>
            <div>{details.error_classification}</div>
          </div>
        )}

        {/* Structured Diagnostics Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '4px 10px',
            fontSize: '0.71rem',
            lineHeight: 1.3,
          }}
        >
          {/* URL */}
          <div style={{ color: theme.colors.textSecondary, fontWeight: 500 }}>URL:</div>
          <div
            style={{
              color: theme.colors.text,
              fontFamily: 'monospace',
              wordBreak: 'break-all',
              userSelect: 'text',
            }}
          >
            {details.url || '—'}
          </div>

          {/* Timestamp */}
          <div style={{ color: theme.colors.textSecondary, fontWeight: 500 }}>
            {t('download.timestampLabel') || 'Время'}:
          </div>
          <div style={{ color: theme.colors.text, fontFamily: 'monospace', userSelect: 'text' }}>
            {details.timestamp}
          </div>

          {/* Platform */}
          <div style={{ color: theme.colors.textSecondary, fontWeight: 500 }}>
            {t('download.platformLabel') || 'Платформа'}:
          </div>
          <div style={{ color: theme.colors.text, fontFamily: 'monospace', userSelect: 'text' }}>
            {details.os} ({details.arch})
          </div>

          {/* Exit code */}
          <div style={{ color: theme.colors.textSecondary, fontWeight: 500 }}>
            {t('download.statusLabel') || 'Статус'}:
          </div>
          <div style={{ color: theme.colors.text, fontFamily: 'monospace', userSelect: 'text' }}>
            {details.exit_code !== null && details.exit_code !== undefined
              ? `Exit code ${details.exit_code}`
              : details.status}
          </div>

          {/* Executable */}
          <div style={{ color: theme.colors.textSecondary, fontWeight: 500 }}>
            {t('download.executableLabel') || 'Исполняемый файл'}:
          </div>
          <div
            style={{
              color: theme.colors.text,
              fontFamily: 'monospace',
              wordBreak: 'break-all',
              userSelect: 'text',
            }}
          >
            {details.executable}
          </div>

          {/* Environment/Proxy */}
          {details.environment && details.environment.length > 0 && (
            <>
              <div style={{ color: theme.colors.textSecondary, fontWeight: 500 }}>
                {t('download.envLabel') || 'Сетевое окружение'}:
              </div>
              <div
                style={{
                  color: theme.colors.text,
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                  userSelect: 'text',
                }}
              >
                {details.environment.join(' | ')}
              </div>
            </>
          )}
        </div>

        {/* Command section */}
        {details.command && (
          <div>
            <div
              style={{
                fontSize: '0.69rem',
                fontWeight: 600,
                color: theme.colors.textSecondary,
                marginBottom: '3px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>{t('download.command') || 'Выполненная команда'}:</span>
              <button
                type="button"
                onClick={handleCopyCmd}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: copiedCmd ? (theme.colors.success || '#22c55e') : theme.colors.textSecondary,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  fontSize: '0.68rem',
                  padding: '1px 4px',
                  borderRadius: '3px',
                }}
                title={copiedCmd ? 'Скопировано!' : 'Скопировать команду'}
              >
                {copiedCmd ? <Check size={11} /> : <Copy size={11} />}
                <span>{copiedCmd ? 'Скопировано' : 'Копировать команду'}</span>
              </button>
            </div>
            <div
              style={{
                padding: '5px 8px',
                background: 'rgba(0, 0, 0, 0.4)',
                borderRadius: '4px',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                fontFamily: 'monospace',
                fontSize: '0.70rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                color: theme.colors.text,
                userSelect: 'text',
                maxHeight: '85px',
                overflowY: 'auto',
              }}
            >
              {details.command}
            </div>
          </div>
        )}

        {/* STDERR log */}
        {(details.stderr || details.status) && (
          <div>
            <div
              style={{
                fontSize: '0.69rem',
                fontWeight: 600,
                color: theme.colors.error || '#ef4444',
                marginBottom: '3px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>{t('download.stderrLabel') || 'Лог ошибок (stderr)'}:</span>
              <button
                type="button"
                onClick={handleCopyStderr}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: copiedStderr ? (theme.colors.success || '#22c55e') : theme.colors.textSecondary,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  fontSize: '0.68rem',
                  padding: '1px 4px',
                  borderRadius: '3px',
                }}
                title={copiedStderr ? 'Скопировано!' : 'Скопировать лог ошибок'}
              >
                {copiedStderr ? <Check size={11} /> : <Copy size={11} />}
                <span>{copiedStderr ? 'Скопировано' : 'Копировать лог'}</span>
              </button>
            </div>
            <div
              style={{
                padding: '6px 8px',
                background: 'rgba(0, 0, 0, 0.5)',
                borderRadius: '4px',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                fontFamily: 'monospace',
                fontSize: '0.70rem',
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#fca5a5',
                userSelect: 'text',
                maxHeight: '220px',
                overflowY: 'auto',
              }}
            >
              {details.stderr || details.status}
            </div>
          </div>
        )}

        {/* STDOUT log (if non-empty) */}
        {details.stdout && details.stdout.trim().length > 0 && (
          <div>
            <div
              style={{
                fontSize: '0.69rem',
                fontWeight: 600,
                color: theme.colors.textSecondary,
                marginBottom: '3px',
              }}
            >
              {t('download.stdoutLabel') || 'Вывод команды (stdout)'}:
            </div>
            <div
              style={{
                padding: '6px 8px',
                background: 'rgba(0, 0, 0, 0.4)',
                borderRadius: '4px',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                fontFamily: 'monospace',
                fontSize: '0.70rem',
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: theme.colors.textSecondary,
                userSelect: 'text',
                maxHeight: '120px',
                overflowY: 'auto',
              }}
            >
              {details.stdout}
            </div>
          </div>
        )}

        {/* Recommendation hint */}
        {details.hint && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '6px',
              fontSize: '0.71rem',
              color: theme.colors.textSecondary,
              lineHeight: 1.35,
              padding: '6px 8px',
              background: 'rgba(255, 255, 255, 0.04)',
              borderRadius: '4px',
              border: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            <span style={{ fontSize: '0.85rem' }}>💡</span>
            <span style={{ flex: 1 }}>{details.hint}</span>
          </div>
        )}
      </div>
    </details>
  );
};

export default TechnicalDetailsViewer;
