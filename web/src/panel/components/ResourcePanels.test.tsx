import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExplorerPanel } from './ExplorerPanel';
import { SourceControlPanel } from './SourceControlPanel';
import {
  handleResourceResult,
  installResourceStore,
  replayResourceSubscriptions,
  resourceDiffPreview,
  resetResourceProject,
  setResourceWorkspace,
} from '../lib/resource-store';
import { installPrincipalRole } from '../lib/auth-state';

afterEach(() => { cleanup(); resetResourceProject(); installPrincipalRole(null); vi.unstubAllGlobals(); });

describe('VS Code-style resource panels', () => {
  it('lazy-loads a directory when its tree row expands', async () => {
    const sent: unknown[] = [];
    installResourceStore({ send: (frame) => { sent.push(frame); return true; }, ready: () => true, toast: vi.fn() });
    setResourceWorkspace({
      projectId: 'project-1',
      directories: { '': { generation: 'g1', nextCursor: 'g1.1', entries: [{ id: 'src', name: 'src', path: 'src', kind: 'directory' }] } },
      repositories: [], loading: [], error: null,
    });
    render(() => <ExplorerPanel />);
    await fireEvent.click(screen.getByRole('treeitem', { name: /src/i }));
    expect(sent).toContainEqual(expect.objectContaining({
      t: 'resource_query', type: 'resource/open-view', projectId: 'project-1',
      payload: expect.objectContaining({ kind: 'fs-directory-page', path: 'src' }),
    }));
    await fireEvent.click(screen.getByRole('button', { name: 'Load more…' }));
    expect(sent).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({ kind: 'fs-directory-page', path: '', cursor: 'g1.1' }),
    }));
  });

  it('opens a principal-bound Git diff blob from a change row', async () => {
    const sent: unknown[] = [];
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n-before\n+after\n',
    });
    vi.stubGlobal('fetch', fetch);
    installResourceStore({ send: (frame) => { sent.push(frame); return true; }, ready: () => true, toast: vi.fn() });
    installPrincipalRole('full');
    setResourceWorkspace({
      projectId: 'project-1', directories: {}, loading: [], error: null,
      repositories: [{
        id: 'repo-1', root: '', name: 'peri-studio', headName: 'main', generation: 'g1', groups: {
          working_tree: { count: 1, revision: 'r1', nextCursor: 'g1.1', changes: [{ id: 'c1', path: 'src/main.ts', status: 'modified' }] },
        },
      }],
    });
    render(() => <SourceControlPanel />);
    expect(screen.getByText('peri-studio')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('Changes')).toBeInTheDocument();
    expect(screen.getByText('main.ts')).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /Open changes for src\/main\.ts/i }));
    expect(sent).toContainEqual(expect.objectContaining({
      t: 'resource_query', type: 'resource/open-blob', projectId: 'project-1',
      payload: { kind: 'git-diff', repoId: 'repo-1', changeId: 'c1' },
    }));
    const open = sent.find((frame) => (frame as { type?: string }).type === 'resource/open-blob') as { requestId: string };
    handleResourceResult({
      t: 'resource_result', requestId: open.requestId,
      result: { kind: 'blob', data: { blobId: 'blob-1', url: '/api/resource-blobs/blob-1', expiresAt: '2026-08-23T12:00:00Z' } },
    });
    await waitFor(() => expect(resourceDiffPreview()?.text).toContain('+after'));
    expect(fetch).toHaveBeenCalledWith('/api/resource-blobs/blob-1', expect.objectContaining({
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Stage src/main.ts' }));
    expect(sent).toContainEqual(expect.objectContaining({
      t: 'resource_query', type: 'resource/git-action', projectId: 'project-1',
      payload: { repoId: 'repo-1', action: 'stage', changeIds: ['c1'], expectedGeneration: 'g1' },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Load more…' }));
    expect(sent).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({ kind: 'git-group-page', repoId: 'repo-1', groupId: 'working_tree', cursor: 'g1.1' }),
    }));
  });

  it('reopens short-lived resource views after reconnect instead of replaying stale doc ids', () => {
    const sent: unknown[] = [];
    installResourceStore({ send: (frame) => { sent.push(frame); return true; }, ready: () => true, toast: vi.fn() });
    setResourceWorkspace({
      projectId: 'project-1', directories: {}, repositories: [], loading: [], error: null,
    });
    handleResourceResult({
      t: 'resource_result', requestId: 'request-1',
      result: { kind: 'view', data: { viewId: 'view-1', docId: 'resource:view-1', leaseExpiresAt: '2026-08-23T12:00:00Z' } },
    });
    sent.length = 0;

    replayResourceSubscriptions();

    expect(sent).toContainEqual({ t: 'ysync.unsubscribe', docs: ['resource:view-1'] });
    expect(sent).toContainEqual(expect.objectContaining({
      t: 'resource_query', type: 'resource/release-view', payload: { viewId: 'view-1' },
    }));
    expect(sent).toContainEqual(expect.objectContaining({
      t: 'resource_query', type: 'resource/open-view', projectId: 'project-1',
      payload: expect.objectContaining({ kind: 'fs-directory-page', path: '' }),
    }));
    expect(sent).toContainEqual(expect.objectContaining({
      t: 'resource_query', type: 'resource/open-view', projectId: 'project-1',
      payload: expect.objectContaining({ kind: 'workspace-repositories-page' }),
    }));
  });
});
