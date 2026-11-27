import { describe, it, expect } from 'vitest';
import { FFmpegCommandBuilder } from '../RenderService';
import { DEFAULT_VIDEO_SETTINGS, DEFAULT_AUDIO_SETTINGS } from '../../types';

describe('FFmpegCommandBuilder - GIF rendering', () => {
  it('should generate high quality palette filter for GIF format', () => {
    const videoSettings = {
      ...DEFAULT_VIDEO_SETTINGS,
      targetFormat: 'gif' as const,
      gifSettings: {
        fps: '15',
        width: '480',
        dither: 'bayer' as const,
        loop: 0,
      },
    };

    const builder = new FFmpegCommandBuilder(
      videoSettings,
      DEFAULT_AUDIO_SETTINGS,
      undefined,
      false,
      'C:/videos/output_szhatoe.gif'
    );

    const args = builder.buildArgs();

    expect(args).toContain('-filter_complex');
    const filterArg = args[args.indexOf('-filter_complex') + 1];
    expect(filterArg).toContain('fps=15');
    expect(filterArg).toContain('scale=480:-2:flags=lanczos');
    expect(filterArg).toContain('palettegen=stats_mode=diff');
    expect(filterArg).toContain('paletteuse=diff_mode=rectangle:dither=bayer:bayer_scale=3');

    // No audio stream for GIF
    expect(args).toContain('-an');

    // Infinite loop
    expect(args).toContain('-loop');
    expect(args[args.indexOf('-loop') + 1]).toBe('0');
  });

  it('should support floyd-steinberg dithering for GIF', () => {
    const videoSettings = {
      ...DEFAULT_VIDEO_SETTINGS,
      targetFormat: 'gif' as const,
      gifSettings: {
        fps: '20',
        width: '640',
        dither: 'floyd_steinberg' as const,
        loop: 0,
      },
    };

    const builder = new FFmpegCommandBuilder(
      videoSettings,
      DEFAULT_AUDIO_SETTINGS,
      undefined,
      false,
      'C:/videos/test.gif'
    );

    const args = builder.buildArgs();
    const filterArg = args[args.indexOf('-filter_complex') + 1];
    expect(filterArg).toContain('fps=20');
    expect(filterArg).toContain('scale=640:-2:flags=lanczos');
    expect(filterArg).toContain('paletteuse=diff_mode=rectangle:dither=floyd_steinberg');
  });

  it('should pass validation for GIF without video codec errors', () => {
    const videoSettings = {
      ...DEFAULT_VIDEO_SETTINGS,
      targetFormat: 'gif' as const,
    };

    const builder = new FFmpegCommandBuilder(
      videoSettings,
      DEFAULT_AUDIO_SETTINGS,
      undefined,
      false,
      'output.gif'
    );

    const validation = builder.validate();
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });
});
