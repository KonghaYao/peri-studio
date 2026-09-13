import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceUploadBatchView } from '@/features/resource/upload-workspace-file';
import { workspaceUploadAttachmentItems } from './composer-upload-attachments';

function batch(items: WorkspaceUploadBatchView['items']): WorkspaceUploadBatchView {
  return { generation: 1, projectId: 'project-1', items };
}

describe('workspaceUploadAttachmentItems', () => {
  it('maps composer uploads for the active project into shell attachments', () => {
    const retry = vi.fn();
    const items = workspaceUploadAttachmentItems({
      batch: batch([{
        id: 'upload-1',
        displayName: 'clipboard-20260913-144529.png',
        workspaceRelativePath: 'clipboard-20260913-144529.png',
        size: 128,
        phase: 'uploading',
        progressLoaded: 64,
        progressTotal: 128,
        error: null,
        committedPath: null,
        referenceInjected: false,
      }]),
      projectId: 'project-1',
      origin: 'composer',
      resolveOrigin: (id) => (id === 'upload-1' ? 'composer' : undefined),
      tileStatus: () => 'uploading',
      progressPercent: () => 50,
      retry,
      dismiss: vi.fn(),
      getDraft: () => '',
      setDraft: vi.fn(),
    });

    expect(items).toEqual([{
      id: 'upload-1',
      name: 'clipboard-20260913-144529.png',
      kind: 'image',
      status: 'uploading',
      progress: 50,
      errorMessage: undefined,
      onRetry: undefined,
    }]);
  });

  it('ignores other projects and origins', () => {
    const items = workspaceUploadAttachmentItems({
      batch: batch([{
        id: 'upload-1',
        displayName: 'notes.txt',
        workspaceRelativePath: 'notes.txt',
        size: 4,
        phase: 'ready',
        progressLoaded: 4,
        progressTotal: 4,
        error: null,
        committedPath: 'notes.txt',
        referenceInjected: false,
      }]),
      projectId: 'project-2',
      origin: 'composer',
      resolveOrigin: () => 'quickstart',
      tileStatus: () => 'ready',
      progressPercent: () => 100,
      retry: vi.fn(),
      dismiss: vi.fn(),
      getDraft: () => '',
      setDraft: vi.fn(),
    });

    expect(items).toEqual([]);
  });

  it('wires retry for retryable failures', () => {
    const retry = vi.fn();
    const items = workspaceUploadAttachmentItems({
      batch: batch([{
        id: 'upload-1',
        displayName: 'notes.txt',
        workspaceRelativePath: 'notes.txt',
        size: 4,
        phase: 'failed',
        progressLoaded: 0,
        progressTotal: 4,
        error: { code: 'UNAVAILABLE', message: 'Upload failed.', retryable: true },
        committedPath: null,
        referenceInjected: false,
      }]),
      projectId: 'project-1',
      origin: 'composer',
      resolveOrigin: () => 'composer',
      tileStatus: () => 'failed',
      progressPercent: () => 0,
      retry,
      dismiss: vi.fn(),
      getDraft: () => '',
      setDraft: vi.fn(),
    });

    items[0]?.onRetry?.();
    expect(retry).toHaveBeenCalledWith('upload-1');
  });

  it('wires remove for ready uploads and strips the injected reference', () => {
    const dismiss = vi.fn();
    const setDraft = vi.fn();
    const items = workspaceUploadAttachmentItems({
      batch: batch([{
        id: 'upload-1',
        displayName: 'clipboard-20260913-144529.png',
        workspaceRelativePath: 'clipboard-20260913-144529.png',
        size: 128,
        phase: 'ready',
        progressLoaded: 128,
        progressTotal: 128,
        error: null,
        committedPath: 'clipboard-20260913-144529.png',
        referenceInjected: true,
      }]),
      projectId: 'project-1',
      origin: 'composer',
      resolveOrigin: () => 'composer',
      tileStatus: () => 'ready',
      progressPercent: () => 100,
      retry: vi.fn(),
      dismiss,
      getDraft: () => 'Review @clipboard-20260913-144529.png',
      setDraft,
    });

    expect(items[0]?.onRemove).toBeTypeOf('function');
    items[0]?.onRemove?.();
    expect(dismiss).toHaveBeenCalledWith('upload-1');
    expect(setDraft).toHaveBeenCalledWith('Review');
  });
});
