/**
 * FFmpeg Command Line Argument Evaluator
 * Verifies argument list conformance to VideoToolbox and NVENC platform specifications.
 */

import { FORBIDDEN_VIDEOTOOLBOX_FLAGS, NVENC_PRESET_PREFIX } from './contracts';

export interface EvaluationResult {
  valid: boolean;
  violations: string[];
}

export class ArgumentEvaluator {
  /**
   * Find index of a flag in arguments array
   */
  static findFlag(args: string[], flag: string): number {
    return args.indexOf(flag);
  }

  /**
   * Get value following a flag in arguments array
   */
  static getFlagValue(args: string[], flag: string): string | null {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
    }
    return null;
  }

  /**
   * Check if any forbidden VideoToolbox flags are present in arguments
   */
  static findForbiddenVideoToolboxFlags(args: string[]): string[] {
    const violations: string[] = [];
    for (const forbidden of FORBIDDEN_VIDEOTOOLBOX_FLAGS) {
      if (args.includes(forbidden)) {
        violations.push(`Found forbidden flag: ${forbidden}`);
      }
    }
    // Also check for NVENC preset flags (-preset p1..p7)
    const presetIdx = args.indexOf('-preset');
    if (presetIdx !== -1 && presetIdx + 1 < args.length) {
      const presetVal = args[presetIdx + 1];
      if (NVENC_PRESET_PREFIX.test(presetVal)) {
        violations.push(`Found forbidden NVENC preset: -preset ${presetVal}`);
      }
    }
    return violations;
  }

  /**
   * Validate VideoToolbox command arguments against contract
   */
  static evaluateVideoToolbox(
    args: string[],
    codec: 'h264' | 'h265' | 'hevc',
    options?: {
      expectedQuality?: number;
      expectedBitrate?: string;
    }
  ): EvaluationResult {
    const violations: string[] = [];

    // Verify encoder flag
    const encoder = this.getFlagValue(args, '-c:v');
    const expectedEncoder = codec === 'h264' ? 'h264_videotoolbox' : 'hevc_videotoolbox';
    if (encoder !== expectedEncoder) {
      violations.push(`Expected encoder '${expectedEncoder}', got '${encoder}'`);
    }

    // Verify absence of NVENC flags
    const forbidden = this.findForbiddenVideoToolboxFlags(args);
    violations.push(...forbidden);

    // Verify rate control parameters
    if (options?.expectedQuality !== undefined) {
      const qVal = this.getFlagValue(args, '-q:v');
      if (qVal !== options.expectedQuality.toString()) {
        violations.push(`Expected -q:v '${options.expectedQuality}', got '${qVal}'`);
      }
    }

    if (options?.expectedBitrate !== undefined) {
      const bVal = this.getFlagValue(args, '-b:v');
      if (bVal !== options.expectedBitrate) {
        violations.push(`Expected -b:v '${options.expectedBitrate}', got '${bVal}'`);
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  /**
   * Validate NVENC command arguments against Windows contract
   */
  static evaluateNvenc(
    args: string[],
    codec: 'h264' | 'h265' | 'hevc',
    options?: {
      expectedCq?: number;
      expectedPreset?: string;
    }
  ): EvaluationResult {
    const violations: string[] = [];

    // Verify encoder flag
    const encoder = this.getFlagValue(args, '-c:v');
    const expectedEncoder = codec === 'h264' ? 'h264_nvenc' : 'hevc_nvenc';
    if (encoder !== expectedEncoder) {
      violations.push(`Expected NVENC encoder '${expectedEncoder}', got '${encoder}'`);
    }

    // Verify CQ parameter if expected
    if (options?.expectedCq !== undefined) {
      const cqVal = this.getFlagValue(args, '-cq');
      if (cqVal !== options.expectedCq.toString()) {
        violations.push(`Expected -cq '${options.expectedCq}', got '${cqVal}'`);
      }
      // NVENC should also include -rc constqp or -rc vbr
      const rcVal = this.getFlagValue(args, '-rc');
      if (!rcVal || (rcVal !== 'constqp' && rcVal !== 'vbr')) {
        violations.push(`Expected -rc constqp or vbr for NVENC, got '${rcVal}'`);
      }
    }

    // Verify preset if expected
    if (options?.expectedPreset) {
      const presetVal = this.getFlagValue(args, '-preset');
      if (presetVal !== options.expectedPreset) {
        violations.push(`Expected NVENC preset '${options.expectedPreset}', got '${presetVal}'`);
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }
}
