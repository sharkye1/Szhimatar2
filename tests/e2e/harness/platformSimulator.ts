/**
 * Platform Environment Simulator
 * Allows switching between macOS, Windows, and Linux environments deterministically.
 */

import { PlatformOS } from './contracts';

export class PlatformSimulator {
  private static originalPlatform: string = process.platform;
  private static originalNavigator: any = (globalThis as any).navigator;

  /**
   * Set simulated OS platform
   */
  static setPlatform(os: PlatformOS): void {
    if (os === 'macos') {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          platform: 'MacIntel',
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
        },
        configurable: true,
        writable: true,
      });
    } else if (os === 'windows') {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          platform: 'Win32',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
        },
        configurable: true,
        writable: true,
      });
    } else if (os === 'linux') {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          platform: 'Linux x86_64',
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)',
        },
        configurable: true,
        writable: true,
      });
    } else {
      Object.defineProperty(process, 'platform', { value: 'unknown', configurable: true });
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          platform: '',
          userAgent: '',
        },
        configurable: true,
        writable: true,
      });
    }
  }

  /**
   * Restore real host platform
   */
  static restore(): void {
    Object.defineProperty(process, 'platform', { value: this.originalPlatform, configurable: true });
    Object.defineProperty(globalThis, 'navigator', {
      value: this.originalNavigator,
      configurable: true,
      writable: true,
    });
  }

  /**
   * Check if src/utils/platform.ts is present in codebase
   */
  static async loadPlatformUtil(): Promise<{
    isMacOS?: () => boolean;
    isWindows?: () => boolean;
    getPlatformOS?: () => PlatformOS;
  } | null> {
    try {
      const modulePath = '../../../src/utils/platform';
      const mod = await import(modulePath);
      return mod;
    } catch {
      return null;
    }
  }
}
