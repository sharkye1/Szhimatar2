import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Copy,
  Check,
  Terminal,
  AlertTriangle,
  Info,
  CheckCircle2,
  ChevronDown,
  FileText,
  Maximize2,
  X,
  Layers,
} from 'lucide-react';
import { TechnicalDetails } from '../types/technicalDetails';
import { formatDiagnosticReport, copyTextToClipboard } from '../utils/technicalDetails';

export type TechnicalDetailsTabKey = 'summary' | 'stderr' | 'command' | 'stdout' | 'all';

export interface TechnicalDetailsViewerProps {
  details: TechnicalDetails;
  theme: any;
  t: (key: string) => string;
  defaultOpen?: boolean;
  initialTab?: TechnicalDetailsTabKey;
}

export const TechnicalDetailsViewer: React.FC<TechnicalDetailsViewerProps> = ({
  details,
  theme,
  t,
  defaultOpen = false,
  initialTab = 'summary',
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState<TechnicalDetailsTabKey>(initialTab);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [copiedReport, setCopiedReport] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedStderr, setCopiedStderr] = useState(false);
  const [copiedStdout, setCopiedStdout] = useState(false);

  const reportTimerRef = useRef<number | null>(null);
  const cmdTimerRef = useRef<number | null>(null);
  const stderrTimerRef = useRef<number | null>(null);
  const stdoutTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
      if (cmdTimerRef.current) clearTimeout(cmdTimerRef.current);
      if (stderrTimerRef.current) clearTimeout(stderrTimerRef.current);
      if (stdoutTimerRef.current) clearTimeout(stdoutTimerRef.current);
    };
  }, []);

  // Handle escape key to close modal
  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  if (!details) {
    return null;
  }

  const handleCopyReport = async (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
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

  const handleCopyCmd = async (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
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

  const handleCopyStderr = async (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
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

  const handleCopyStdout = async (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!details.stdout) return;
    const success = await copyTextToClipboard(details.stdout);
    if (success) {
      setCopiedStdout(true);
      if (stdoutTimerRef.current) clearTimeout(stdoutTimerRef.current);
      stdoutTimerRef.current = window.setTimeout(() => {
        setCopiedStdout(false);
      }, 2000);
    }
  };

  const copyBtnLabel = copiedReport
    ? (t('download.copiedDiagnostics') || 'Скопировано!')
    : (t('download.copyDiagnostics') || 'Скопировать отчет');

  const availableTabs: { id: TechnicalDetailsTabKey; label: string; icon?: React.ReactNode; count?: string | number }[] = [
    { id: 'summary', label: t('download.tabSummary') || 'Сводка' },
    {
      id: 'stderr',
      label: t('download.tabStderr') || 'Лог (stderr)',
      count: details.stderr ? details.stderr.split('\n').filter(Boolean).length : undefined,
    },
    ...(details.command ? [{ id: 'command' as TechnicalDetailsTabKey, label: t('download.tabCommand') || 'Команда' }] : []),
    ...(details.stdout && details.stdout.trim().length > 0
      ? [{ id: 'stdout' as TechnicalDetailsTabKey, label: t('download.tabStdout') || 'Вывод (stdout)' }]
      : []),
    { id: 'all', label: t('download.tabAll') || 'Все разделы' },
  ];

  const renderClassification = () => {
    if (!details.error_classification) return null;
    return (
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
    );
  };

  const renderMetadataGrid = () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: '4px 10px',
        fontSize: '0.71rem',
        lineHeight: 1.3,
      }}
    >
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

      <div style={{ color: theme.colors.textSecondary, fontWeight: 500 }}>
        {t('download.timestampLabel') || 'Время'}:
      </div>
      <div style={{ color: theme.colors.text, fontFamily: 'monospace', userSelect: 'text' }}>
        {details.timestamp}
      </div>

      <div style={{ color: theme.colors.textSecondary, fontWeight: 500 }}>
        {t('download.platformLabel') || 'Платформа'}:
      </div>
      <div style={{ color: theme.colors.text, fontFamily: 'monospace', userSelect: 'text' }}>
        {details.os} ({details.arch})
      </div>

      <div style={{ color: theme.colors.textSecondary, fontWeight: 500 }}>
        {t('download.statusLabel') || 'Статус'}:
      </div>
      <div style={{ color: theme.colors.text, fontFamily: 'monospace', userSelect: 'text' }}>
        {details.exit_code !== null && details.exit_code !== undefined
          ? `Exit code ${details.exit_code}`
          : details.status}
      </div>

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
  );

  const renderRecommendationHint = () => {
    if (!details.hint) return null;
    return (
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
    );
  };

  const renderCommand = (isModal: boolean) => {
    if (!details.command) return null;
    return (
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
            <span>{copiedCmd ? 'Скопировано' : 'Копировать'}</span>
          </button>
        </div>
        <div
          style={{
            padding: '6px 8px',
            background: 'rgba(0, 0, 0, 0.4)',
            borderRadius: '4px',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            fontFamily: 'monospace',
            fontSize: '0.70rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            color: theme.colors.text,
            userSelect: 'text',
            maxHeight: isModal ? '280px' : '150px',
            overflowY: 'auto',
          }}
        >
          {details.command}
        </div>
      </div>
    );
  };

  const renderStderr = (isModal: boolean) => {
    const textToDisplay = details.stderr || details.status;
    if (!textToDisplay) return null;
    return (
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
            <span>{copiedStderr ? 'Скопировано' : 'Копировать'}</span>
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
            maxHeight: isModal ? '400px' : '180px',
            overflowY: 'auto',
          }}
        >
          {textToDisplay}
        </div>
      </div>
    );
  };

  const renderStdout = (isModal: boolean) => {
    if (!details.stdout || details.stdout.trim().length === 0) return null;
    return (
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
          <span>{t('download.stdoutLabel') || 'Вывод команды (stdout)'}:</span>
          <button
            type="button"
            onClick={handleCopyStdout}
            style={{
              background: 'transparent',
              border: 'none',
              color: copiedStdout ? (theme.colors.success || '#22c55e') : theme.colors.textSecondary,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              fontSize: '0.68rem',
              padding: '1px 4px',
              borderRadius: '3px',
            }}
            title={copiedStdout ? 'Скопировано!' : 'Скопировать stdout'}
          >
            {copiedStdout ? <Check size={11} /> : <Copy size={11} />}
            <span>{copiedStdout ? 'Скопировано' : 'Копировать'}</span>
          </button>
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
            maxHeight: isModal ? '280px' : '140px',
            overflowY: 'auto',
          }}
        >
          {details.stdout}
        </div>
      </div>
    );
  };

  const renderTabContent = (isModal: boolean) => {
    switch (activeTab) {
      case 'summary':
        return (
          <>
            {renderClassification()}
            {renderMetadataGrid()}
            {renderRecommendationHint()}
          </>
        );
      case 'stderr':
        return renderStderr(isModal);
      case 'command':
        return renderCommand(isModal);
      case 'stdout':
        return renderStdout(isModal);
      case 'all':
      default:
        return (
          <>
            {renderClassification()}
            {renderMetadataGrid()}
            {renderCommand(isModal)}
            {renderStderr(isModal)}
            {renderStdout(isModal)}
            {renderRecommendationHint()}
          </>
        );
    }
  };

  return (
    <>
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

        {/* Expanded diagnostic card — strictly bounded height */}
        <div
          className="technical-details-card"
          style={{
            marginTop: '6px',
            padding: '8px 10px',
            background: 'rgba(0, 0, 0, 0.38)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '6px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            maxHeight: 'min(310px, 38vh)',
            overflow: 'hidden',
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
              paddingBottom: '6px',
              flexShrink: 0,
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
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={details.status}
              >
                {details.is_network_error ? (
                  <AlertTriangle size={13} color={theme.colors.warning || '#eab308'} style={{ flexShrink: 0 }} />
                ) : (
                  <Info size={13} color={theme.colors.primary || '#3b82f6'} style={{ flexShrink: 0 }} />
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{details.status}</span>
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
              {/* Maximize / Dialog Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setIsModalOpen(true);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 8px',
                  fontSize: '0.70rem',
                  fontWeight: 500,
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '5px',
                  color: theme.colors.textSecondary,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
                title={t('download.expandModal') || 'Развернуть в окне'}
              >
                <Maximize2 size={12} strokeWidth={2} />
                <span>{t('download.expandModal') || 'В окне'}</span>
              </button>

              {/* Copy Report Button */}
              <button
                type="button"
                onClick={handleCopyReport}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 8px',
                  fontSize: '0.70rem',
                  fontWeight: 500,
                  background: copiedReport ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                  border: copiedReport
                    ? '1px solid rgba(34, 197, 94, 0.4)'
                    : '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '5px',
                  color: copiedReport ? (theme.colors.success || '#22c55e') : theme.colors.text,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
                title={t('download.copyDiagnosticsTooltip') || 'Скопировать полный отчет об ошибке в буфер обмена'}
              >
                {copiedReport ? (
                  <CheckCircle2 size={12} strokeWidth={2.2} />
                ) : (
                  <Copy size={12} strokeWidth={2} />
                )}
                <span>{copyBtnLabel}</span>
              </button>
            </div>
          </div>

          {/* Sub-sections Tab Strip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              flexWrap: 'wrap',
              paddingBottom: '2px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              flexShrink: 0,
            }}
          >
            {availableTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveTab(tab.id);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 7px',
                    fontSize: '0.68rem',
                    fontWeight: isActive ? 600 : 500,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    border: isActive
                      ? `1px solid ${theme.colors.primary || '#3b82f6'}80`
                      : '1px solid rgba(255, 255, 255, 0.08)',
                    background: isActive
                      ? `${theme.colors.primary || '#3b82f6'}26`
                      : 'rgba(255, 255, 255, 0.04)',
                    color: isActive ? (theme.colors.primary || '#60a5fa') : theme.colors.textSecondary,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined && (
                    <span
                      style={{
                        fontSize: '0.62rem',
                        padding: '0 3px',
                        borderRadius: '3px',
                        background: 'rgba(239, 68, 68, 0.2)',
                        color: '#fca5a5',
                      }}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Scrollable Tab Content Container */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              paddingRight: '2px',
            }}
          >
            {renderTabContent(false)}
          </div>
        </div>
      </details>

      {/* Modal Dialog for full view */}
      {isModalOpen &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 99999,
              background: 'rgba(0, 0, 0, 0.75)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              boxSizing: 'border-box',
            }}
            onClick={() => setIsModalOpen(false)}
          >
            <div
              style={{
                width: '92vw',
                maxWidth: '820px',
                height: '85vh',
                maxHeight: '700px',
                background: theme.colors.surface || '#18181b',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '12px',
                boxShadow: '0 24px 64px rgba(0, 0, 0, 0.7)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                color: theme.colors.text,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                  background: 'rgba(255, 255, 255, 0.03)',
                  gap: '8px',
                  flexShrink: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                  <Terminal size={16} strokeWidth={2} style={{ color: theme.colors.primary || '#3b82f6', flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                    {t('download.technicalDetails') || 'Технические подробности'}
                  </span>
                  {details.is_network_error && (
                    <span
                      style={{
                        fontSize: '0.68rem',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: 'rgba(234, 179, 8, 0.2)',
                        color: theme.colors.warning || '#eab308',
                        fontWeight: 600,
                      }}
                    >
                      Сбой сети
                    </span>
                  )}
                  {details.exit_code !== null && details.exit_code !== undefined && (
                    <span
                      style={{
                        fontSize: '0.68rem',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: 'rgba(239, 68, 68, 0.2)',
                        color: theme.colors.error || '#ef4444',
                        fontWeight: 600,
                      }}
                    >
                      Код {details.exit_code}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={handleCopyReport}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 10px',
                      fontSize: '0.74rem',
                      fontWeight: 500,
                      background: copiedReport ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                      border: copiedReport
                        ? '1px solid rgba(34, 197, 94, 0.4)'
                        : '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '5px',
                      color: copiedReport ? (theme.colors.success || '#22c55e') : theme.colors.text,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {copiedReport ? <CheckCircle2 size={13} strokeWidth={2.2} /> : <Copy size={13} strokeWidth={2} />}
                    <span>{copyBtnLabel}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '5px',
                      color: theme.colors.textSecondary,
                      width: '28px',
                      height: '28px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                    title={t('download.closeModal') || 'Закрыть'}
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* Modal Tabs */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  background: 'rgba(0, 0, 0, 0.2)',
                  flexShrink: 0,
                }}
              >
                {availableTabs.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '4px 10px',
                        fontSize: '0.74rem',
                        fontWeight: isActive ? 600 : 500,
                        borderRadius: '5px',
                        cursor: 'pointer',
                        border: isActive
                          ? `1px solid ${theme.colors.primary || '#3b82f6'}80`
                          : '1px solid rgba(255, 255, 255, 0.08)',
                        background: isActive
                          ? `${theme.colors.primary || '#3b82f6'}26`
                          : 'rgba(255, 255, 255, 0.04)',
                        color: isActive ? (theme.colors.primary || '#60a5fa') : theme.colors.textSecondary,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span>{tab.label}</span>
                      {tab.count !== undefined && (
                        <span
                          style={{
                            fontSize: '0.65rem',
                            padding: '0 4px',
                            borderRadius: '3px',
                            background: 'rgba(239, 68, 68, 0.2)',
                            color: '#fca5a5',
                          }}
                        >
                          {tab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Modal Body */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                {renderTabContent(true)}
              </div>

              {/* Modal Footer */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 16px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  background: 'rgba(0, 0, 0, 0.25)',
                  fontSize: '0.74rem',
                  color: theme.colors.textSecondary,
                  flexShrink: 0,
                }}
              >
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                  {details.status}
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{
                    padding: '4px 14px',
                    fontSize: '0.74rem',
                    borderRadius: '5px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: theme.colors.text,
                    cursor: 'pointer',
                  }}
                >
                  {t('download.closeModal') || 'Закрыть'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default TechnicalDetailsViewer;
