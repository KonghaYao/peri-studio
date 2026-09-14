import { describe, expect, it } from 'vitest';
import type { WorkspaceUploadBatchView } from '@/features/resource/upload-workspace-file';
import { composerUploadSendGate } from './composer-upload-send-gate';

function batch(items: WorkspaceUploadBatchView['items']): WorkspaceUploadBatchView {
  return { generation: 1, projectId: 'project-1', items };
}

describe('composerUploadSendGate', () => {
  it('blocks send while composer uploads are still in flight', () => {
    const gate = composerUploadSendGate(
      batch([{
        id: 'upload-1',
        displayName: 'notes.txt',
        workspaceRelativePath: 'notes.txt',
        size: 4,
        phase: 'uploading',
        progressLoaded: 1,
        progressTotal: 4,
        error: null,
        committedPath: null,
        referenceInjected: false,
      }]),
      'project-1',
      'composer',
      () => 'composer',
    );

    expect(gate.sendLocked).toBe(true);
    expect(gate.notice).toBe('Wait for attachments to finish uploading before sending.');
  });

  it('allows send when uploads are ready or failed', () => {
    expect(composerUploadSendGate(
      batch([
        {
          id: 'ready',
          displayName: 'ready.txt',
          workspaceRelativePath: 'ready.txt',
          size: 4,
          phase: 'ready',
          progressLoaded: 4,
          progressTotal: 4,
          error: null,
          committedPath: 'ready.txt',
          referenceInjected: true,
        },
        {
          id: 'failed',
          displayName: 'failed.txt',
          workspaceRelativePath: 'failed.txt',
          size: 4,
          phase: 'failed',
          progressLoaded: 0,
          progressTotal: 4,
          error: { code: 'UNAVAILABLE', message: 'Upload failed.', retryable: true },
          committedPath: null,
          referenceInjected: false,
        },
      ]),
      'project-1',
      'composer',
      () => 'composer',
    ).sendLocked).toBe(false);
  });

  it('ignores other projects and origins', () => {
    const gate = composerUploadSendGate(
      batch([{
        id: 'upload-1',
        displayName: 'notes.txt',
        workspaceRelativePath: 'notes.txt',
        size: 4,
        phase: 'uploading',
        progressLoaded: 1,
        progressTotal: 4,
        error: null,
        committedPath: null,
        referenceInjected: false,
      }]),
      'project-2',
      'composer',
      () => 'composer',
    );

    expect(gate.sendLocked).toBe(false);
  });
});
