import { invoke } from '@tauri-apps/api/tauri';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/tauri', () => ({ invoke: vi.fn() }));

describe('processed video history', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('keeps successful inputs and outputs across a restart after statistics are cleared', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const previousRenders = [
      { status: 'completed', inputPath: 'C:\\Clips\\First.MP4', outputPath: 'C:\\Exports\\First.MP4' },
      { status: 'error', inputPath: 'C:\\Clips\\Failed.MP4', outputPath: 'C:\\Exports\\Failed.MP4' },
      { status: 'stopped', inputPath: 'C:\\Clips\\Stopped.MP4', outputPath: 'C:\\Exports\\Stopped.MP4' },
    ];
    vi.mocked(invoke)
      .mockResolvedValueOnce(JSON.stringify({ renders: previousRenders }))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(JSON.stringify({ renders: [] }));

    const { default: service } = await import('./StatisticsService');
    await service.init();
    expect(service.getProcessedVideoPaths()).toEqual(new Set(['c:/clips/first.mp4', 'c:/exports/first.mp4']));

    const subscriber = vi.fn();
    service.subscribe(subscriber);
    service.markRenderComplete('no-statistics-record', {
      inputPath: 'C:/Clips/Second.mp4',
      outputPath: 'C:/Exports/Second.mp4',
    });
    expect(subscriber).toHaveBeenCalledOnce();
    await service.clearHistory();

    vi.resetModules();
    const { default: restarted } = await import('./StatisticsService');
    await restarted.init();
    expect(restarted.getProcessedVideoPaths()).toEqual(new Set([
      'c:/clips/first.mp4', 'c:/exports/first.mp4',
      'c:/clips/second.mp4', 'c:/exports/second.mp4',
    ]));
  });
});
