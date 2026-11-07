import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  callbacks: new Map<string, (event: { payload: any }) => void>(),
  invoke: vi.fn(),
}));
vi.mock('@tauri-apps/api/tauri', () => ({ invoke: transport.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name, callback) => {
    transport.callbacks.set(name, callback);
    return () => {};
  }),
}));

const emit = (name: string, payload: object) => transport.callbacks.get(name)!({ payload });

beforeEach(() => {
  vi.resetModules();
  transport.callbacks.clear();
  transport.invoke.mockReset().mockResolvedValue(true);
});

async function start() {
  const service = (await import('../../src/services/DownloadService')).default;
  const id = await service.startDownload('https://example.com/video', 'best', 'mp4', 'MP4', 'C:/Downloads');
  return { service, id };
}

describe('DownloadService lifecycle', () => {
  it('publishes immutable updates without changing other jobs', async () => {
    const { service, id } = await start();
    await service.startDownload('https://example.com/second', 'best', 'mp4', 'MP4', 'C:/Downloads');
    const before = service.getQueue();
    emit('download-progress', { job_id: id, progress_percent: 45, speed: '2MiB/s' });
    const after = service.getQueue();
    expect(after[0]).not.toBe(before[0]);
    expect(before[0].progress).toBe(0);
    expect(after[0].progress).toBe(45);
    expect(after[1]).toBe(before[1]);
  });

  it('does not report a refused stop as successful', async () => {
    const { service, id } = await start();
    transport.invoke.mockResolvedValueOnce(false);
    expect(await service.stopDownload(id)).toBe(false);
    expect(service.getQueue()[0].status).toBe('downloading');
  });

  it('waits for backend confirmation and ignores progress after stopping', async () => {
    const { service, id } = await start();
    expect(await service.stopDownload(id)).toBe(true);
    expect(service.getQueue()[0].status).toBe('downloading');
    emit('download-stopped', { job_id: id });
    const stopped = service.getQueue()[0];
    emit('download-progress', { job_id: id, progress_percent: 80 });
    emit('download-started', { job_id: id });
    expect(service.getQueue()[0]).toBe(stopped);
    expect(stopped.status).toBe('stopped');
  });

  it('keeps completion when a late stop or error arrives', async () => {
    const { service, id } = await start();
    emit('download-complete', { job_id: id, file_path: 'C:/Downloads/test.webm' });
    const completed = service.getQueue()[0];
    emit('download-stopped', { job_id: id });
    emit('download-error', { job_id: id, error: 'late error' });
    expect(service.getQueue()[0]).toBe(completed);
    expect(completed.status).toBe('completed');
    expect(completed.format).toBe('webm');
  });

  it('registers completion listeners before invoking a download', async () => {
    transport.invoke.mockImplementation(async (name, args) => {
      if (name === 'download_media_link') {
        emit('download-complete', { job_id: args.jobId, file_path: 'C:/Downloads/fast.mp4' });
      }
      return true;
    });
    const { service } = await start();
    expect(service.getQueue()[0].status).toBe('completed');
  });
});
