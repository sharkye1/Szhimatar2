import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe,
  ShieldCheck,
  ChevronDown,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';

export interface DetectedProxy {
  url: string;
  source: string;
}

export interface ProxyDetectionResult {
  proxy: DetectedProxy | null;
  vpnName?: string | null;
  vpn_name?: string | null;
}

export const NetworkProxySettings: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const { theme } = useTheme();
  const { t } = useLanguage();

  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [detectedProxy, setDetectedProxy] = useState<DetectedProxy | null>(null);
  const [detectedVpn, setDetectedVpn] = useState<string | null>(null);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const loadDetectedProxy = useCallback(async () => {
    setIsDetecting(true);
    try {
      const res = await invoke<ProxyDetectionResult>('detect_system_proxy');
      if (res && typeof res === 'object') {
        setDetectedProxy(res.proxy || null);
        const rawVpn = (res.vpnName ?? res.vpn_name ?? '').trim();
        const cleanVpn = rawVpn.replace(/^"+|"+$/g, '').trim();
        setDetectedVpn(cleanVpn || null);
      } else {
        setDetectedProxy(null);
        setDetectedVpn(null);
      }
    } catch (e) {
      console.warn('[NetworkProxySettings] detect_system_proxy failed:', e);
      setDetectedProxy(null);
      setDetectedVpn(null);
    } finally {
      setIsDetecting(false);
    }
  }, []);

  useEffect(() => {
    loadDetectedProxy();
  }, [loadDetectedProxy]);

  const handleTestProxy = async () => {
    const urlToTest = settings.proxyUrl?.trim() || detectedProxy?.url;
    if (!urlToTest) {
      setTestResult({
        success: false,
        message:
          t('proxy.noProxyToTest') ||
          'Нет адреса прокси для проверки. Укажите адрес вручную или запустите прокси.',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const msg = await invoke<string>('test_proxy_connection', {
        proxyUrl: urlToTest,
      });
      setTestResult({
        success: true,
        message: msg || `OK: ${urlToTest}`,
      });
    } catch (e: unknown) {
      const errMsg = typeof e === 'string' ? e : (e as any)?.message || String(e);
      setTestResult({
        success: false,
        message: errMsg || 'Ошибка подключения к прокси',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const getSummary = () => {
    if (settings.proxyMode === 'disabled') {
      return {
        isActive: false,
        label: t('proxy.modeDisabled') || 'Отключено (прямое)',
        hint: t('proxy.directHint') || 'Используется только прямое подключение.',
        type: 'disabled' as const,
      };
    }
    if (settings.proxyUrl && settings.proxyUrl.trim()) {
      return {
        isActive: true,
        label: `${t('proxy.summaryCustom') || 'Прокси'}: ${settings.proxyUrl.trim()}`,
        hint: settings.proxyUrl.trim(),
        type: 'custom' as const,
      };
    }
    if (detectedProxy) {
      return {
        isActive: true,
        label: `${detectedProxy.url}`,
        hint: detectedProxy.source,
        type: 'proxy' as const,
      };
    }
    if (detectedVpn) {
      return {
        isActive: true,
        label: `VPN: "${detectedVpn}"`,
        hint: t('proxy.vpnHint') || 'Трафик направляется через системный VPN.',
        type: 'vpn' as const,
      };
    }
    return {
      isActive: false,
      label: t('proxy.summaryDirect') || 'Прямое подключение',
      hint: t('proxy.notDetected') || 'Активный прокси или VPN не обнаружен.',
      type: 'direct' as const,
    };
  };

  const summary = getSummary();

  return (
    <div
      className="setting-group"
      style={{
        flexShrink: 0,
        minHeight: 'fit-content',
        padding: 0,
        overflow: 'hidden',
        border: isExpanded
          ? '1px solid rgba(255, 255, 255, 0.18)'
          : '1px solid rgba(255, 255, 255, 0.1)',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
      }}
    >
      {/* Clickable Header Bar */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded((prev) => !prev);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          cursor: 'pointer',
          userSelect: 'none',
          gap: 12,
          background: isExpanded ? 'rgba(255, 255, 255, 0.03)' : 'transparent',
          transition: 'background 0.2s ease',
        }}
      >
        {/* Left: Icon, Title, and Compact Status Badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 7,
              background: summary.isActive
                ? 'rgba(34, 197, 94, 0.15)'
                : 'rgba(255, 255, 255, 0.08)',
              color: summary.isActive ? '#4ade80' : theme.colors.textSecondary,
              flexShrink: 0,
            }}
          >
            {summary.type === 'vpn' ? <ShieldCheck size={16} /> : <Globe size={16} />}
          </div>

          <span style={{ fontWeight: 600, fontSize: 14, color: theme.colors.text }}>
            {t('proxy.title')}
          </span>

          {/* Active Route Pill Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 10px',
              borderRadius: 14,
              fontSize: 12,
              fontWeight: 500,
              background: summary.isActive
                ? 'rgba(34, 197, 94, 0.12)'
                : 'rgba(255, 255, 255, 0.06)',
              color: summary.isActive ? '#4ade80' : theme.colors.textSecondary,
              border: `1px solid ${
                summary.isActive ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255, 255, 255, 0.1)'
              }`,
              maxWidth: '320px',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: summary.isActive ? '#22c55e' : '#9ca3af',
                boxShadow: summary.isActive ? '0 0 6px rgba(34, 197, 94, 0.7)' : 'none',
                flexShrink: 0,
              }}
            />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {summary.label}
            </span>
          </div>
        </div>

        {/* Right: Expand/Collapse Text & Animated Chevron */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>
            {isExpanded ? t('proxy.collapse') : t('proxy.expand')}
          </span>
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            style={{ display: 'flex', alignItems: 'center' }}
          >
            <ChevronDown size={16} style={{ color: theme.colors.textSecondary }} />
          </motion.div>
        </div>
      </div>

      {/* Expanded Accordion Body */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="proxy-content"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                padding: '8px 18px 18px 18px',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              {/* Active Route Status Card with Refresh */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 14px',
                  background: 'rgba(var(--theme-bg-rgb), 0.2)',
                  borderRadius: 10,
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    flex: '1 1 240px',
                  }}
                >
                  <div
                    style={{
                      marginTop: 2,
                      color: summary.isActive ? '#4ade80' : theme.colors.textSecondary,
                      flexShrink: 0,
                    }}
                  >
                    {summary.type === 'vpn' ? <ShieldCheck size={18} /> : <Globe size={18} />}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme.colors.text }}>
                      {detectedVpn
                        ? t('proxy.vpnDetected').replace('{name}', detectedVpn)
                        : detectedProxy
                        ? `${t('proxy.detected')} ${detectedProxy.url} (${detectedProxy.source})`
                        : t('proxy.notDetected')}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: theme.colors.textSecondary,
                        lineHeight: 1.4,
                      }}
                    >
                      {detectedVpn
                        ? t('proxy.vpnHint')
                        : detectedProxy
                        ? t('proxy.proxyHint')
                        : t('proxy.directHint')}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    loadDetectedProxy();
                  }}
                  disabled={isDetecting}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: theme.colors.text,
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: 6,
                    padding: '6px 12px',
                    cursor: isDetecting ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                    fontWeight: 500,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <motion.span
                    animate={isDetecting ? { rotate: 360 } : { rotate: 0 }}
                    transition={
                      isDetecting
                        ? { repeat: Infinity, duration: 1, ease: 'linear' }
                        : {}
                    }
                    style={{ display: 'inline-flex' }}
                  >
                    <RefreshCw size={13} />
                  </motion.span>
                  <span>{t('proxy.refreshDetect')}</span>
                </button>
              </div>

              {/* Mode Selection */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: theme.colors.text }}>
                  {t('proxy.modeLabel')}
                </div>
                <select
                  value={settings.proxyMode || 'auto'}
                  onChange={(e) =>
                    updateSettings(
                      { proxyMode: e.target.value as 'auto' | 'always' | 'disabled' },
                      true
                    )
                  }
                  style={{ width: '100%', maxWidth: 500 }}
                >
                  <option value="auto">{t('proxy.modeAuto')}</option>
                  <option value="always">{t('proxy.modeAlways')}</option>
                  <option value="disabled">{t('proxy.modeDisabled')}</option>
                </select>
              </div>

              {/* Custom Proxy URL */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: theme.colors.text }}>
                  {t('proxy.customUrlLabel')}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={settings.proxyUrl || ''}
                    onChange={(e) => updateSettings({ proxyUrl: e.target.value }, true)}
                    placeholder={
                      detectedProxy
                        ? `${t('proxy.placeholderDetected')} ${detectedProxy.url}`
                        : 'http://127.0.0.1:7890 или socks5://127.0.0.1:10808'
                    }
                    style={{ flex: '1 1 260px' }}
                  />
                  <button
                    type="button"
                    onClick={handleTestProxy}
                    disabled={isTesting}
                    style={{
                      background: theme.colors.primary,
                      color: '#fff',
                      padding: '10px 16px',
                      border: 'none',
                      borderRadius: 8,
                      cursor: isTesting ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                      fontWeight: 500,
                      flexShrink: 0,
                      transition: 'opacity 0.15s ease',
                    }}
                  >
                    {isTesting ? t('proxy.testing') : t('proxy.testButton')}
                  </button>
                </div>
                <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>
                  {t('proxy.customHint')}
                </div>

                {testResult && (
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 12,
                      padding: '8px 12px',
                      borderRadius: 6,
                      background: testResult.success
                        ? `${theme.colors.success}20`
                        : `${theme.colors.error}20`,
                      color: testResult.success ? theme.colors.success : theme.colors.error,
                      border: `1px solid ${
                        testResult.success ? theme.colors.success : theme.colors.error
                      }40`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      wordBreak: 'break-all',
                    }}
                  >
                    {testResult.success ? (
                      <CheckCircle2 size={14} style={{ flexShrink: 0 }} />
                    ) : (
                      <AlertCircle size={14} style={{ flexShrink: 0 }} />
                    )}
                    <span>{testResult.message}</span>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NetworkProxySettings;
