import { describe, expect, it, vi } from 'vitest';
import { putResourceUploadBytes } from './upload-http-put';

class FakeEventTarget {
  private readonly listeners = new Map<string, Array<(event: ProgressEvent) => void>>();

  addEventListener(type: string, listener: (event: ProgressEvent) => void): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  dispatch(type: string, event: ProgressEvent = new ProgressEvent(type)): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeRequest extends FakeEventTarget {
  readonly upload = new FakeEventTarget();
  readonly open = vi.fn();
  readonly setRequestHeader = vi.fn();
  readonly send = vi.fn();
  readonly abort = vi.fn(() => this.dispatch('abort'));
  withCredentials = false;
  status = 0;
}

describe('putResourceUploadBytes', () => {
  it('uses same-origin cookie PUT and reports intermediate upload progress', async () => {
    const request = new FakeRequest();
    const progress = vi.fn();
    const result = putResourceUploadBytes(
      '/api/resource-uploads/upload-1',
      new Blob(['data']),
      { onProgress: progress },
      () => request as unknown as XMLHttpRequest,
    );

    expect(request.open).toHaveBeenCalledWith('PUT', '/api/resource-uploads/upload-1', true);
    expect(request.withCredentials).toBe(true);
    expect(request.setRequestHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    request.upload.dispatch('progress', new ProgressEvent('progress', { lengthComputable: true, loaded: 2, total: 4 }));
    request.status = 204;
    request.dispatch('load');

    await expect(result).resolves.toEqual({ ok: true, status: 204 });
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { loaded: 0, total: 4 },
      { loaded: 2, total: 4 },
      { loaded: 4, total: 4 },
    ]);
  });

  it('reports network errors without converting them to HTTP responses', async () => {
    const request = new FakeRequest();
    const result = putResourceUploadBytes(
      '/api/resource-uploads/upload-1',
      new Blob(['data']),
      {},
      () => request as unknown as XMLHttpRequest,
    );

    request.dispatch('error');
    await expect(result).rejects.toThrow('upload_transport_error');
  });

  it('aborts before sending when the caller signal is already cancelled', async () => {
    const request = new FakeRequest();
    const controller = new AbortController();
    controller.abort();
    const result = putResourceUploadBytes(
      '/api/resource-uploads/upload-1',
      new Blob(['data']),
      { signal: controller.signal },
      () => request as unknown as XMLHttpRequest,
    );

    expect(request.abort).toHaveBeenCalledOnce();
    expect(request.send).not.toHaveBeenCalled();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('aborts the request when the caller signal is cancelled', async () => {
    const request = new FakeRequest();
    const controller = new AbortController();
    const result = putResourceUploadBytes(
      '/api/resource-uploads/upload-1',
      new Blob(['data']),
      { signal: controller.signal },
      () => request as unknown as XMLHttpRequest,
    );

    controller.abort();
    expect(request.abort).toHaveBeenCalledOnce();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});
