import { describe, expect, it } from 'vitest';
import type { WorkspaceUploadItemView } from '@/features/resource/upload-workspace-file';
import { explorerUploadRefreshTransition, submittedWorkspaceUploadItemIds, type WorkspaceUploadOrigin } from './workspace-upload';

function item(phase: WorkspaceUploadItemView['phase']): WorkspaceUploadItemView {
  return {
    id: phase,
    displayName: `${phase}.txt`,
    workspaceRelativePath: `${phase}.txt`,
    size: 4,
    phase,
    progressLoaded: 0,
    progressTotal: 4,
    error: null,
    committedPath: phase === 'ready' ? `${phase}.txt` : null,
    referenceInjected: false,
  };
}

describe('Explorer upload refresh', () => {
  it('refreshes once when a successful batch reaches terminal states', () => {
    expect(explorerUploadRefreshTransition(false, [item('uploading'), item('failed')])).toEqual({
      busy: true,
      refresh: false,
    });
    expect(explorerUploadRefreshTransition(true, [item('ready'), item('failed')])).toEqual({
      busy: false,
      refresh: true,
    });
    expect(explorerUploadRefreshTransition(false, [item('ready'), item('failed')])).toEqual({
      busy: false,
      refresh: false,
    });
  });

  it('selects only submitted assets owned by the current draft origin', () => {
    const readyComposer = { ...item('ready'), id: 'composer-ready', referenceInjected: true };
    const readyExplorer = { ...item('ready'), id: 'explorer-ready', referenceInjected: true };
    const failedComposer = { ...item('failed'), id: 'composer-failed', referenceInjected: true };
    const origins = new Map<string, WorkspaceUploadOrigin>([
      ['composer-ready', 'composer'],
      ['explorer-ready', 'explorer'],
      ['composer-failed', 'composer'],
    ] as const);

    expect(submittedWorkspaceUploadItemIds(
      { generation: 1, projectId: 'project-1', items: [readyComposer, readyExplorer, failedComposer] },
      'project-1',
      'composer',
      (id) => origins.get(id),
    )).toEqual(['composer-ready']);
    expect(submittedWorkspaceUploadItemIds(
      { generation: 1, projectId: 'project-1', items: [readyComposer] },
      'project-2',
      'composer',
      (id) => origins.get(id),
    )).toEqual([]);
  });

  it('does not refresh an all-failed batch', () => {
    expect(explorerUploadRefreshTransition(true, [item('failed')])).toEqual({
      busy: false,
      refresh: false,
    });
  });
});
