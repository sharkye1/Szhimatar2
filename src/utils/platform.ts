/**
 * Platform Detection Utility
 * Synchronous, zero-lag platform detection for instant UI rendering and system routing.
 * Conforms to Milestone 2 architecture and E2E Test Suite contracts.
 */

export type PlatformOS = 'macos' | 'windows' | 'linux' | 'unknown';
export type PlatformArch = 'arm64' | 'x64' | 'unknown';

export interface PlatformInfo {
  os: PlatformOS;
  arch: PlatformArch;
}

declare const process: any;

// Internal override state for deterministic unit & e2e testing
let platformOverride: PlatformOS | null = null;
let archOverride: PlatformArch | null = null;

/**
 * Set platform override for testing purposes.
 */
export function setPlatformOverride(os: PlatformOS | null, arch: PlatformArch | null = null): void {
  platformOverride = os;
  archOverride = arch;
}

/**
 * Reset platform override to real host detection.
 */
export function resetPlatformOverride(): void {
  platformOverride = null;
  archOverride = null;
}

/**
 * Synchronous, zero-lag platform OS detection.
 * Evaluates dynamically on each call so simulated environments take effect immediately.
 */
export function getPlatformOS(): PlatformOS {
  if (platformOverride) {
    return platformOverride;
  }

  // 1. Check navigator if available (Browser / Tauri Webview / JSDOM / Test Simulator)
  if (typeof navigator !== 'undefined') {
    // 1a. Modern User-Agent Client Hints
    const uaDataPlatform = (navigator as any)?.userAgentData?.platform;
    if (typeof uaDataPlatform === 'string' && uaDataPlatform.length > 0) {
      const p = uaDataPlatform.toLowerCase();
      if (p.includes('mac')) return 'macos';
      if (p.includes('win')) return 'windows';
      if (p.includes('linux')) return 'linux';
    }

    // 1b. Traditional navigator.platform and userAgent
    const plat = (navigator.platform || '').toLowerCase();
    const ua = (navigator.userAgent || '').toLowerCase();

    if (plat.includes('mac') || ua.includes('macintosh') || ua.includes('mac os x') || ua.includes('darwin')) {
      return 'macos';
    }
    if (plat.includes('win') || ua.includes('windows') || ua.includes('win32') || ua.includes('win64')) {
      return 'windows';
    }
    if (plat.includes('linux') || ua.includes('linux') || ua.includes('x11')) {
      return 'linux';
    }
  }

  // 2. Fallback to process.platform (Node.js / Vitest / Electron)
  if (typeof process !== 'undefined' && typeof process.platform === 'string') {
    const p = process.platform.toLowerCase();
    if (p === 'darwin') return 'macos';
    if (p === 'win32') return 'windows';
    if (p === 'linux') return 'linux';
  }

  // 3. Fallback to Vite/Tauri build-time environment variable
  try {
    const tauriPlatform = import.meta?.env?.TAURI_PLATFORM;
    if (tauriPlatform) {
      const p = String(tauriPlatform).toLowerCase();
      if (p === 'darwin') return 'macos';
      if (p === 'win32' || p === 'windows') return 'windows';
      if (p === 'linux') return 'linux';
    }
  } catch {
    // Ignore import.meta evaluation errors in non-ESM test contexts
  }

  return 'unknown';
}

/**
 * Returns true if running on macOS.
 */
export function isMacOS(): boolean {
  return getPlatformOS() === 'macos';
}

/**
 * Returns true if running on Windows.
 */
export function isWindows(): boolean {
  return getPlatformOS() === 'windows';
}

/**
 * Returns true if running on Linux.
 */
export function isLinux(): boolean {
  return getPlatformOS() === 'linux';
}

/**
 * Synchronous architecture detection.
 */
export function getPlatformArch(): PlatformArch {
  if (archOverride) {
    return archOverride;
  }

  if (typeof process !== 'undefined' && typeof process.arch === 'string') {
    const a = process.arch.toLowerCase();
    if (a === 'arm64' || a === 'aarch64') return 'arm64';
    if (a === 'x64' || a === 'x86_64') return 'x64';
  }

  if (typeof navigator !== 'undefined') {
    const ua = (navigator.userAgent || '').toLowerCase();
    if (/arm64|aarch64/i.test(ua)) return 'arm64';
    if (/x86_64|win64|x64|wow64/i.test(ua)) return 'x64';
  }

  return 'unknown';
}

/**
 * Returns true if running on Apple Silicon (macOS + arm64).
 */
export function isAppleSilicon(): boolean {
  return isMacOS() && getPlatformArch() === 'arm64';
}

/**
 * Returns platform key formatted for Tauri updater / latest.json manifest.
 * Used by UpdateService.
 */
export function getPlatformKey(): string {
  const os = getPlatformOS();
  const arch = getPlatformArch();

  if (os === 'macos') {
    return arch === 'arm64' ? 'darwin-aarch64' : 'darwin-x86_64';
  }
  if (os === 'windows') {
    return 'windows-x86_64';
  }
  if (os === 'linux') {
    return arch === 'arm64' ? 'linux-aarch64' : 'linux-x86_64';
  }
  return 'windows-x86_64';
}

/**
 * Returns platform information object compatible with TechnicalDetails.
 */
export function detectPlatformInfo(): PlatformInfo {
  return {
    os: getPlatformOS(),
    arch: getPlatformArch(),
  };
}
