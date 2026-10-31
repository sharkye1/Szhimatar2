import { describe, it, expect } from 'vitest';
import ru from '../../src/lang/ru.json';
import en from '../../src/lang/en.json';
import ch from '../../src/lang/ch.json';
import eo from '../../src/lang/eo.json';
import my from '../../src/lang/my.json';
import emp from '../../src/lang/emp.json';
import vz from '../../src/lang/vz.json';

describe('Proxy and VPN Detection Display Logic & Localization', () => {
  const languages = [
    { code: 'ru', dict: ru },
    { code: 'en', dict: en },
    { code: 'ch', dict: ch },
    { code: 'eo', dict: eo },
    { code: 'my', dict: my },
    { code: 'emp', dict: emp },
    { code: 'vz', dict: vz },
  ];

  it('ensures all translation dictionaries contain the required proxy keys', () => {
    for (const { code, dict } of languages) {
      expect(dict.proxy, `Missing proxy section in ${code}`).toBeDefined();
      expect('detected' in dict.proxy, `Missing proxy.detected in ${code}`).toBe(true);
      expect('vpnDetected' in dict.proxy, `Missing proxy.vpnDetected in ${code}`).toBe(true);
      expect('notDetected' in dict.proxy, `Missing proxy.notDetected in ${code}`).toBe(true);
      expect('expand' in dict.proxy, `Missing proxy.expand in ${code}`).toBe(true);
      expect('collapse' in dict.proxy, `Missing proxy.collapse in ${code}`).toBe(true);
      expect('vpnHint' in dict.proxy, `Missing proxy.vpnHint in ${code}`).toBe(true);
      expect('proxyHint' in dict.proxy, `Missing proxy.proxyHint in ${code}`).toBe(true);
      expect('directHint' in dict.proxy, `Missing proxy.directHint in ${code}`).toBe(true);
    }
  });

  it('verifies expandable accordion proxy summary computation logic', () => {
    const computeProxySummary = (
      proxyMode: 'auto' | 'always' | 'disabled',
      proxyUrl: string,
      detectedProxy: { url: string; source: string } | null,
      detectedVpn: string | null
    ) => {
      if (proxyMode === 'disabled') {
        return {
          isActive: false,
          label: ru.proxy.modeDisabled,
          type: 'disabled',
        };
      }
      if (proxyUrl && proxyUrl.trim()) {
        return {
          isActive: true,
          label: `${ru.proxy.summaryCustom}: ${proxyUrl.trim()}`,
          type: 'custom',
        };
      }
      if (detectedProxy) {
        return {
          isActive: true,
          label: detectedProxy.url,
          type: 'proxy',
        };
      }
      if (detectedVpn) {
        return {
          isActive: true,
          label: `VPN: "${detectedVpn}"`,
          type: 'vpn',
        };
      }
      return {
        isActive: false,
        label: ru.proxy.summaryDirect,
        type: 'direct',
      };
    };

    // 1. VPN active (e.g. Anywhere VPN connected on macOS)
    const vpnSummary = computeProxySummary('auto', '', null, 'Anywhere');
    expect(vpnSummary.isActive).toBe(true);
    expect(vpnSummary.type).toBe('vpn');
    expect(vpnSummary.label).toBe('VPN: "Anywhere"');

    // 2. Custom proxy takes precedence over auto-detection
    const customSummary = computeProxySummary('auto', 'http://127.0.0.1:10809', null, 'Anywhere');
    expect(customSummary.isActive).toBe(true);
    expect(customSummary.type).toBe('custom');
    expect(customSummary.label).toBe('Пользовательский: http://127.0.0.1:10809');

    // 3. Local proxy client detected (e.g. Clash on 7890)
    const proxySummary = computeProxySummary('auto', '', { url: 'http://127.0.0.1:7890', source: 'Clash' }, null);
    expect(proxySummary.isActive).toBe(true);
    expect(proxySummary.type).toBe('proxy');
    expect(proxySummary.label).toBe('http://127.0.0.1:7890');

    // 4. Disabled mode
    const disabledSummary = computeProxySummary('disabled', 'http://127.0.0.1:7890', null, 'Anywhere');
    expect(disabledSummary.isActive).toBe(false);
    expect(disabledSummary.type).toBe('disabled');
    expect(disabledSummary.label).toContain('Отключено');

    // 5. Direct (no VPN, no proxy)
    const directSummary = computeProxySummary('auto', '', null, null);
    expect(directSummary.isActive).toBe(false);
    expect(directSummary.type).toBe('direct');
    expect(directSummary.label).toBe('Прямое подключение');
  });

  it('verifies Russian proxy and VPN status text formatting', () => {
    // 1. Proxy detected
    expect(ru.proxy.detected).toBe('🟢 Обнаружен прокси:');
    const proxyUrl = 'http://127.0.0.1:7890';
    const proxySource = 'Clash / Mihomo HTTP (порт 7890)';
    const proxyLine = `${ru.proxy.detected} ${proxyUrl} (${proxySource})`;
    expect(proxyLine).toBe('🟢 Обнаружен прокси: http://127.0.0.1:7890 (Clash / Mihomo HTTP (порт 7890))');

    // 2. VPN detected (no proxy)
    const vpnName = 'Anywhere';
    const vpnLine = ru.proxy.vpnDetected.replace('{name}', vpnName);
    expect(vpnLine).toBe('🟢 Подключен системный VPN: "Anywhere" (трафик уже идёт через него, прокси не требуется)');

    // 3. Neither detected
    expect(ru.proxy.notDetected).toBe('Активный системный или локальный прокси/VPN не обнаружен');
  });

  it('verifies English proxy and VPN status text formatting', () => {
    expect(en.proxy.detected).toBe('🟢 Proxy detected:');
    const vpnName = 'WireGuard';
    const vpnLine = en.proxy.vpnDetected.replace('{name}', vpnName);
    expect(vpnLine).toBe('🟢 System VPN connected: "WireGuard" (traffic already routes through it, proxy not required)');
    expect(en.proxy.notDetected).toBe('No active system or local proxy/VPN detected');
  });

  it('verifies Chinese, Esperanto, Interslavic, and Vzryv formatting with VPN placeholder', () => {
    const vpnName = 'Tailscale';
    expect(ch.proxy.vpnDetected.replace('{name}', vpnName)).toBe('🟢 已连接系统 VPN: "Tailscale" (流量已通过它传输，无需代理)');
    expect(eo.proxy.vpnDetected.replace('{name}', vpnName)).toBe('🟢 Sistema VPN konektita: "Tailscale" (trafiko jam pasas tra ĝi, prokurilo ne necesas)');
    expect(my.proxy.vpnDetected.replace('{name}', vpnName)).toBe('🟢 Podkľučeny sistemny VPN: "Tailscale" (trafik uže idet črěz njego, proksi ne trěbuje se)');
    expect(vz.proxy.vpnDetected.replace('{name}', vpnName)).toBe('🟢 Подключен боевой VPN: "Tailscale" (трафик уже мчит через него, прокси не требуется)');
  });

  it('handles quotes sanitization in VPN name so double quotes are not nested', () => {
    const sanitizeVpn = (raw: string | undefined | null) => {
      const trimmed = (raw ?? '').trim();
      return trimmed.replace(/^"+|"+$/g, '').trim();
    };

    expect(sanitizeVpn('"Anywhere"')).toBe('Anywhere');
    expect(sanitizeVpn('""Anywhere""')).toBe('Anywhere');
    expect(sanitizeVpn('Anywhere')).toBe('Anywhere');
    expect(sanitizeVpn(null)).toBe('');
    expect(sanitizeVpn(undefined)).toBe('');

    const clean = sanitizeVpn('"Anywhere"');
    const formatted = ru.proxy.vpnDetected.replace('{name}', clean);
    expect(formatted).toBe('🟢 Подключен системный VPN: "Anywhere" (трафик уже идёт через него, прокси не требуется)');
  });

  it('simulates GeneralSettings display branch selection', () => {
    const renderStatus = (
      detectedProxy: { url: string; source: string } | null,
      detectedVpn: string | null,
      dict = ru
    ) => {
      if (detectedProxy) {
        return `${dict.proxy.detected} ${detectedProxy.url} (${detectedProxy.source})`;
      } else if (detectedVpn) {
        return dict.proxy.vpnDetected.replace('{name}', detectedVpn);
      } else {
        return dict.proxy.notDetected;
      }
    };

    // Case A: Proxy only
    expect(
      renderStatus({ url: 'http://127.0.0.1:7890', source: 'Clash' }, null)
    ).toBe('🟢 Обнаружен прокси: http://127.0.0.1:7890 (Clash)');

    // Case B: Both proxy and VPN (proxy takes active display precedence in proxy section)
    expect(
      renderStatus({ url: 'http://127.0.0.1:7890', source: 'Clash' }, 'Anywhere')
    ).toBe('🟢 Обнаружен прокси: http://127.0.0.1:7890 (Clash)');

    // Case C: VPN only (e.g. user with Anywhere VPN connected and no local proxy)
    expect(
      renderStatus(null, 'Anywhere')
    ).toBe('🟢 Подключен системный VPN: "Anywhere" (трафик уже идёт через него, прокси не требуется)');

    // Case D: Neither
    expect(
      renderStatus(null, null)
    ).toBe('Активный системный или локальный прокси/VPN не обнаружен');

    // Case E: Multiple VPNs (comma-separated)
    expect(
      renderStatus(null, 'Anywhere, WireGuard')
    ).toBe('🟢 Подключен системный VPN: "Anywhere, WireGuard" (трафик уже идёт через него, прокси не требуется)');
  });

  it('validates NetworkProxySettings module exports and structure', async () => {
    const module = await import('../../src/components/NetworkProxySettings');
    expect(module.NetworkProxySettings).toBeDefined();
    expect(typeof module.NetworkProxySettings).toBe('function');
  });
});
