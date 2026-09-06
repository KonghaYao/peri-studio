import { describe, expect, it } from 'vitest';
import type { WorkspaceUploadItemView } from '@/features/resource/upload-workspace-file';
import { explorerUploadRefreshTransition } from './workspace-upload';

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

  it('does not refresh an all-failed batch', () => {
    expect(explorerUploadRefreshTransition(true, [item('failed')])).toEqual({
      busy: false,
      refresh: false,
    });
  });
});
