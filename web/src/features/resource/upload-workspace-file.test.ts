import { describe, expect, it, vi } from 'vitest';
import type { ResourceResultFrame } from '../../panel/lib/resource-protocol';
import { WorkspaceUploadQueue } from './upload-workspace-file';
import type { LocalUploadCandidate } from './upload-path';

function candidate(id: string, name: string, path: string, body = 'data'): LocalUploadCandidate {
  return {
    id,
    displayName: name,
    size: body.length,
    blob: new Blob([body]),
    workspaceRelativePath: path,
  };
}

function createHarness() {
  const sentQueries: unknown[] = [];
  const sentActions: unknown[] = [];
  let generationValue = 1;
  const queue = new WorkspaceUploadQueue({
    ready: () => true,
    canMutate: () => true,
    generation: () => generationValue,
    sendResourceQuery: (frame) => {
      sentQueries.push(frame);
      return true;
    },
    sendAction: (frame) => {
      sentActions.push(frame);
      return true;
    },
    putUpload: vi.fn(async () => ({ ok: true, status: 204 })),
  });
  return {
    queue,
    sentQueries,
    sentActions,
    bumpGeneration: () => { generationValue += 1; },
    getGeneration: () => generationValue,
  };
}

describe('WorkspaceUploadQueue', () => {
  it('runs open-upload → PUT → fs/write-file with expected wire fields', async () => {
    const { queue, sentQueries, sentActions } = createHarness();
    const views: unknown[] = [];
    queue.setOnChange((view) => views.push(view));

    queue.enqueue('project-1', [{ ok: true, candidate: candidate('f1', 'a.txt', 'a.txt') }]);
    const open = sentQueries[0] as { requestId: string; type: string; payload: { path: string; expectedBytes: number } };
    expect(open.type).toBe('resource/open-upload');
    expect(open.payload.path).toBe('a.txt');
    expect(open.payload.expectedBytes).toBe(4);

    const uploadResult: ResourceResultFrame = {
      t: 'resource_result',
      requestId: open.requestId,
      result: {
        kind: 'upload',
        data: {
          uploadId: 'upload-1',
          url: '/api/resource-uploads/upload-1',
          expiresAt: '2026-09-06T12:00:00Z',
        },
      },
    };
    expect(queue.handleResourceResult(uploadResult)).toBe(true);

    await vi.waitFor(() => {
      expect(sentActions.length).toBe(1);
    });
    const write = sentActions[0] as { type: string; payload: { uploadId: string; ifNoneMatch: string } };
    expect(write.type).toBe('fs/write-file');
    expect(write.payload.uploadId).toBe('upload-1');
    expect(write.payload.ifNoneMatch).toBe('*');

    const commandId = (sentActions[0] as { commandId: string }).commandId;
    queue.handleActionAck({
      commandId,
      status: 'committed',
      resourceResult: { kind: 'fs_stat', data: { path: 'a.txt' } },
    });

    await vi.waitFor(() => {
      const snap = views.at(-1) as { items: Array<{ phase: string; committedPath: string | null }> };
      expect(snap?.items[0]?.phase).toBe('ready');
      expect(snap?.items[0]?.committedPath).toBe('a.txt');
    });
  });

  it('limits parallel PUT work to three items', async () => {
    const { queue, sentQueries } = createHarness();
    const picks = Array.from({ length: 5 }, (_, index) => ({
      ok: true as const,
      candidate: candidate(`f${index}`, `f${index}.txt`, `f${index}.txt`),
    }));
    queue.enqueue('project-1', picks);
    expect(sentQueries.length).toBe(3);
  });

  it('keeps successful items when another file fails', async () => {
    const sentQueries: unknown[] = [];
    const putUpload = vi.fn(async (url: string) => ({
      ok: !url.includes('upload-bad'),
      status: url.includes('upload-bad') ? 500 : 204,
    }));
    const queue = new WorkspaceUploadQueue({
      ready: () => true,
      canMutate: () => true,
      generation: () => 1,
      sendResourceQuery: (frame) => {
        sentQueries.push(frame);
        return true;
      },
      sendAction: () => true,
      putUpload,
    });
    const views: Array<{ items: Array<{ id: string; phase: string }> } | null> = [];
    queue.setOnChange((view) => { if (view) views.push(view); });

    queue.enqueue('project-1', [
      { ok: true, candidate: candidate('good', 'good.txt', 'good.txt') },
      { ok: true, candidate: candidate('bad', 'bad.txt', 'bad.txt') },
    ]);

    (sentQueries as Array<{ requestId: string }>).forEach((frame, index) => {
      const uploadId = index === 1 ? 'upload-bad' : 'upload-good';
      queue.handleResourceResult({
        t: 'resource_result',
        requestId: frame.requestId,
        result: {
          kind: 'upload',
          data: {
            uploadId,
            url: `/api/resource-uploads/${uploadId}`,
            expiresAt: '2026-09-06T12:00:00Z',
          },
        },
      });
    });

    await vi.waitFor(() => {
      const last = views.at(-1);
      expect(last?.items.find((item) => item.id === 'good')?.phase).toBe('committing');
      expect(last?.items.find((item) => item.id === 'bad')?.phase).toBe('failed');
    });
  });

  it('retry issues a fresh open-upload ticket', async () => {
    const { queue, sentQueries } = createHarness();
    queue.enqueue('project-1', [{ ok: true, candidate: candidate('f1', 'a.txt', 'a.txt') }]);
    const firstOpen = sentQueries[0] as { requestId: string };
    queue.handleResourceResult({
      t: 'resource_result',
      requestId: firstOpen.requestId,
      error: { code: 'UPLOAD_EXPIRED', message: 'safe', retryable: true },
    });
    await vi.waitFor(() => {
      expect((queue.snapshot()?.items[0]?.phase)).toBe('failed');
    });
    const before = sentQueries.length;
    queue.retry('f1');
    expect(sentQueries.length).toBe(before + 1);
    expect((sentQueries.at(-1) as { requestId: string }).requestId).not.toBe(firstOpen.requestId);
  });

  it('ignores late resource results after generation changes', async () => {
    const { queue, sentQueries, bumpGeneration } = createHarness();
    queue.enqueue('project-1', [{ ok: true, candidate: candidate('f1', 'a.txt', 'a.txt') }]);
    const open = sentQueries[0] as { requestId: string };
    bumpGeneration();
    expect(queue.handleResourceResult({
      t: 'resource_result',
      requestId: open.requestId,
      result: {
        kind: 'upload',
        data: {
          uploadId: 'upload-late',
          url: '/api/resource-uploads/upload-late',
          expiresAt: '2026-09-06T12:00:00Z',
        },
      },
    })).toBe(true);
    expect(queue.snapshot()?.items[0]?.phase).toBe('opening');
  });
});
