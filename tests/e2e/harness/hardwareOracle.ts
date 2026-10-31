/**
 * Hardware and System Reference Oracle
 * Uses real system commands (sysctl, ffmpeg) on macOS host to act as authoritative reference program
 */

import { execSync } from 'child_process';
import { HardwareInfo } from './contracts';

export class HardwareOracle {
  /**
   * Run host sysctl CPU brand query
   */
  static getHostCpuBrandString(): string | null {
    try {
      const output = execSync('sysctl -n machdep.cpu.brand_string', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      });
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * Authoritative CPU vendor derivation from brand string
   */
  static deriveCpuVendor(brandString: string | null | undefined): { vendor: string; reason: string } {
    if (!brandString || typeof brandString !== 'string') {
      return { vendor: 'unknown', reason: 'empty or missing brand string' };
    }
    const lower = brandString.toLowerCase();
    if (lower.includes('apple') || /^m[1-9]/.test(lower)) {
      return { vendor: 'apple', reason: `sysctl brand_string matched Apple Silicon: ${brandString.trim()}` };
    }
    if (lower.includes('intel')) {
      return { vendor: 'intel', reason: `brand_string contains intel: ${brandString.trim()}` };
    }
    if (lower.includes('amd')) {
      return { vendor: 'amd', reason: `brand_string contains amd: ${brandString.trim()}` };
    }
    return { vendor: 'unknown', reason: `unrecognized brand string: ${brandString.trim()}` };
  }

  /**
   * Run host ffmpeg -encoders to query available encoders
   */
  static getHostFfmpegEncoders(): string {
    try {
      const output = execSync('ffmpeg -hide_banner -encoders', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      });
      return output;
    } catch {
      return '';
    }
  }

  /**
   * Authoritative encoder detector for VideoToolbox
   */
  static detectVideoToolbox(encodersStdout: string): {
    h264: boolean;
    hevc: boolean;
    prores: boolean;
    available: boolean;
  } {
    const lower = encodersStdout.toLowerCase();
    const h264 = lower.includes('h264_videotoolbox');
    const hevc = lower.includes('hevc_videotoolbox');
    const prores = lower.includes('prores_videotoolbox');
    return {
      h264,
      hevc,
      prores,
      available: h264 || hevc,
    };
  }

  /**
   * Authoritative encoder detector for NVENC
   */
  static detectNvenc(encodersStdout: string): {
    h264: boolean;
    hevc: boolean;
    available: boolean;
  } {
    const lower = encodersStdout.toLowerCase();
    const h264 = lower.includes('h264_nvenc');
    const hevc = lower.includes('hevc_nvenc');
    return {
      h264,
      hevc,
      available: lower.includes('nvenc'),
    };
  }

  /**
   * Execute real FFmpeg command with given arguments against dummy test source.
   * Returns { success: boolean, stdout: string, stderr: string, exitCode: number }
   */
  static executeFfmpegWithArgs(args: string[], durationSeconds: number = 0.5): {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
  } {
    try {
      const fullArgs = [
        '-y',
        '-f', 'lavfi',
        '-i', `testsrc=duration=${durationSeconds}:size=320x180:rate=24`,
        ...args,
        '-f', 'null',
        '-',
      ];
      const output = execSync(`ffmpeg ${fullArgs.join(' ')}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 8000,
      });
      return { success: true, stdout: output, stderr: '', exitCode: 0 };
    } catch (err: any) {
      return {
        success: false,
        stdout: err.stdout ? err.stdout.toString() : '',
        stderr: err.stderr ? err.stderr.toString() : err.message || '',
        exitCode: typeof err.status === 'number' ? err.status : 1,
      };
    }
  }

  /**
   * Simulate Windows WMIC output parser
   */
  static parseWmicCpuOutput(stdout: string): { vendor: string; reason: string } {
    const lower = stdout.toLowerCase();
    if (lower.includes('intel')) {
      return { vendor: 'intel', reason: "wmic cpu get name output contains 'intel'" };
    }
    if (lower.includes('amd')) {
      return { vendor: 'amd', reason: "wmic cpu get name output contains 'amd'" };
    }
    return { vendor: 'unknown', reason: `wmic cpu get name did not match known vendor: ${stdout.trim()}` };
  }

  /**
   * Simulate Linux /proc/cpuinfo parser
   */
  static parseProcCpuinfo(content: string): { vendor: string; reason: string } {
    const lower = content.toLowerCase();
    if (lower.includes('intel')) {
      return { vendor: 'intel', reason: "cpuinfo contains 'intel'" };
    }
    if (lower.includes('amd')) {
      return { vendor: 'amd', reason: "cpuinfo contains 'amd'" };
    }
    return { vendor: 'unknown', reason: `/proc/cpuinfo read but vendor not matched: ${content.slice(0, 100)}` };
  }
}
