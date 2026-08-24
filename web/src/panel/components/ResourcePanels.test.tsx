import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExplorerPanel } from './ExplorerPanel';
import { ResourceWorkbench } from './ResourceWorkbench';
import { SourceControlPanel } from './SourceControlPanel';
import {
  activateResourceProject,
  handleResourceResult,
  handleResourceUpdate,
  installResourceStore,
  mutateGitResource,
  replayResourceSubscriptions,
  resourceDiffPreview,
  resourceFilePreview,
  resourceWorkspace,
  resetResourceProject,
  setResourceWorkspace,
} from '../lib/resource-store';
import { installPrincipalRole } from '../lib/auth-state';
import { DocStore } from '../lib/doc-store';
import { setProjects, setProjectSessions, setSelectedSessionId } from '../store';

afterEach(() => {
  cleanup();
  resetResourceProject();
  installPrincipalRole(null);
  setProjects([]);
  setProjectSessions([]);
  setSelectedSessionId(null);
  vi.unstubAllGlobals();
});

describe('VS Code-style resource panels', () => {
  it('releases a stale project view without subscribing to it', () => {
    const sent: Array<Record<string, unknown>> = [];
    installResourceStore({ send: (frame) => { sent.push(frame as Record<string, unknown>); return true; }, ready: () => true, toast: vi.fn() });
    activateResourceProject('project-a');
    const stale = sent.find((frame) => frame.type === 'resource/open-view')!;
    activateResourceProject('project-b');

    handleResourceResult({
      t: 'resource_result', requestId: stale.requestId as string,
      result: { kind: 'view', data: { viewId: 'view-a', docId: 'resource:view-a', leaseExpiresAt: '2026-08-24T00:00:00Z' } },
    });

    expect(resourceWorkspace().projectId).toBe('project-b');
    expect(sent).toContainEqual(expect.objectContaining({ type: 'resource/release-view', payload: { viewId: 'view-a' } }));
    expect(sent).not.toContainEqual(expect.objectContaining({ t: 'ysync.subscribe', docs: ['resource:view-a'] }));
  });

  it('consumes an unleased resource update without allocating a Y.Doc', () => {
    const docFor = vi.spyOn(DocStore.prototype, 'docFor');

    expect(handleResourceUpdate({ doc: 'resource:unleased', update: 'AAAA' })).toBe(true);
    expect(docFor).not.toHaveBeenCalled();
  });

  it('navigates the Explorer as a single-tab-stop ARIA tree', async () => {
    installResourceStore({ send: vi.fn(() => true), ready: () => true, toast: vi.fn() });
    setResourceWorkspace({
      projectId: 'project-1', repositories: [], loading: [], error: null,
      directories: {
        '': { generation: 'g1', entries: [{ id: 'src', name: 'src', path: 'src', kind: 'directory' }] },
        src: { generation: 'g2', entries: [{ id: 'main', name: 'main.ts', path: 'src/main.ts', kind: 'file', size: 24 }] },
      },
    });
    render(() => <ExplorerPanel />);
    const src = screen.getByRole('treeitem', { name: /src/i });

    expect(src).toHaveAttribute('tabindex', '0');
    src.focus();
    await fireEvent.keyDown(src, { key: 'ArrowRight' });
    expect(src).toHaveAttribute('aria-expanded', 'true');
    const file = screen.getByRole('treeitem', { name: /main\.ts/i });
    expect(file).toHaveAttribute('tabindex', '-1');

    await fireEvent.keyDown(src, { key: 'ArrowDown' });
    expect(file).toHaveFocus();
    await fireEvent.keyDown(file, { key: 'ArrowLeft' });
    expect(src).toHaveFocus();
    expect(screen.getByRole('group')).toContainElement(file);

    setResourceWorkspace((current) => ({
      ...current,
      directories: {
        '': { generation: 'g3', entries: [{ id: 'src', name: 'src', path: 'src', kind: 'directory' }] },
        src: { generation: 'g4', entries: [] },
      },
    }));
    await waitFor(() => expect(src).toHaveAttribute('tabindex', '0'));

    setResourceWorkspace((current) => ({
      ...current,
      projectId: 'project-2',
      directories: { '': { generation: 'g5', entries: [{ id: 'readme', name: 'README.md', path: 'README.md', kind: 'file' }] } },
    }));
    const readme = await screen.findByRole('treeitem', { name: /README\.md/i });
    await waitFor(() => expect(readme).toHaveAttribute('tabindex', '0'));
    expect(document.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
  });

  it('lazy-loads a directory when its tree row expands', async () => {
    const sent: unknown[] = [];
    const bytes = new TextEncoder().encode('export const ready = true;\n');
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain; charset=utf-8', 'content-length': String(bytes.byteLength) }),
      })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => bytes.buffer });
    vi.stubGlobal('fetch', fetch);
    installResourceStore({ send: (frame) => { sent.push(frame); return true; }, ready: () => true, toast: vi.fn() });
    setResourceWorkspace({
      projectId: 'project-1',
      directories: {
        '': { generation: 'g1', nextCursor: 'g1.1', entries: [{ id: 'src', name: 'src', path: 'src', kind: 'directory' }] },
        src: { generation: 'g2', entries: [{ id: 'main', name: 'main.ts', path: 'src/main.ts', kind: 'file', size: 24 }] },
      },
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
    await fireEvent.click(screen.getByRole('treeitem', { name: /main\.ts/i }));
    expect(sent).toContainEqual(expect.objectContaining({
      t: 'resource_query', type: 'resource/open-blob', projectId: 'project-1',
      payload: { kind: 'file', path: 'src/main.ts' },
    }));
    expect(resourceFilePreview()).toEqual(expect.objectContaining({ path: 'src/main.ts', loading: true }));
    const open = sent.find((frame) => (frame as { type?: string; payload?: { kind?: string } }).type === 'resource/open-blob'
      && (frame as { payload?: { kind?: string } }).payload?.kind === 'file') as { requestId: string };
    handleResourceResult({
      t: 'resource_result', requestId: open.requestId,
      result: { kind: 'blob', data: { blobId: 'file-blob', url: '/api/resource-blobs/file-blob', expiresAt: '2026-08-23T12:00:00Z', etag: 'file-etag' } },
    });
    await waitFor(() => expect(resourceFilePreview()?.text).toBe('export const ready = true;\n'));
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/resource-blobs/file-blob', expect.objectContaining({ method: 'HEAD', credentials: 'same-origin' }));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/resource-blobs/file-blob', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }));
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
    const stage = screen.getByRole('button', { name: 'Stage src/main.ts' });
    fireEvent.click(stage);
    fireEvent.click(stage);
    expect(sent).toContainEqual(expect.objectContaining({
      t: 'resource_query', type: 'resource/git-action', projectId: 'project-1',
      payload: { repoId: 'repo-1', action: 'stage', changeIds: ['c1'], expectedGeneration: 'g1' },
    }));
    expect(sent.filter((frame) => (frame as { type?: string }).type === 'resource/git-action')).toHaveLength(1);
    expect(stage).toBeDisabled();
    const mutation = sent.find((frame) => (frame as { type?: string }).type === 'resource/git-action') as { requestId: string };
    handleResourceResult({
      t: 'resource_result', requestId: mutation.requestId,
      error: { code: 'UNAVAILABLE', message: 'Git is temporarily unavailable', retryable: true },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Git is temporarily unavailable');
    expect(screen.getByText('peri-studio')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry stage src/main.ts' }));
    expect(sent.filter((frame) => (frame as { type?: string }).type === 'resource/git-action')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Load more…' }));
    expect(sent).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({ kind: 'git-group-page', repoId: 'repo-1', groupId: 'working_tree', cursor: 'g1.1' }),
    }));
  });

  it('keeps commit identity across panel unmount and clears only an exact successful draft', async () => {
    const sent: unknown[] = [];
    installResourceStore({ send: (frame) => { sent.push(frame); return true; }, ready: () => true, toast: vi.fn() });
    installPrincipalRole('full');
    const repository = {
      id: 'repo-1', root: '', name: 'peri-studio', headName: 'main', upstream: 'origin/main', generation: 'g1', ahead: 1, behind: 2,
      groups: { index: { count: 1, revision: 'r1', changes: [{ id: 'c1', path: 'src/main.ts', status: 'modified' }] } },
    };
    setProjects([{ id: 'project-1', name: 'Peri', cwd: '/workspace/peri', instanceId: 'local', createdAt: null, updatedAt: null, archivedAt: null }]);
    setProjectSessions([{ id: 'session-1', projectId: 'project-1', acpSessionId: 'acp-1', title: 'Work', lifecycle: 'ready', updatedAt: null, lastOpenedAt: null, activeChatId: null, archivedAt: null }]);
    setSelectedSessionId('session-1');
    setResourceWorkspace({
      projectId: 'project-1', directories: {}, loading: [], error: null,
      repositories: [repository],
    });
    render(() => <ResourceWorkbench />);
    await fireEvent.click(screen.getByRole('button', { name: 'Source Control' }));
    setResourceWorkspace({ projectId: 'project-1', directories: {}, loading: [], error: null, repositories: [repository] });

    const message = await screen.findByRole('textbox', { name: 'Commit message' });
    const commit = screen.getByRole('button', { name: 'Commit staged changes' });
    expect(commit).toBeDisabled();
    await fireEvent.input(message, { target: { value: '界'.repeat(1_366) } });
    expect(screen.getByRole('alert')).toHaveTextContent('4,096 UTF-8 bytes');
    expect(commit).toBeDisabled();
    await fireEvent.input(message, { target: { value: '  Ship remote SCM  ' } });
    await fireEvent.click(commit);

    expect(sent).toContainEqual(expect.objectContaining({
      t: 'resource_query', type: 'resource/git-action', projectId: 'project-1',
      payload: { repoId: 'repo-1', action: 'commit', changeIds: [], expectedGeneration: 'g1', message: 'Ship remote SCM' },
    }));
    const mutation = sent.find((frame) => (frame as { type?: string }).type === 'resource/git-action') as { requestId: string };
    handleResourceResult({
      t: 'resource_result', requestId: mutation.requestId,
      error: { code: 'UNAVAILABLE', message: 'Commit failed. Check the staged changes and try again.', retryable: false },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Commit failed');
    expect(screen.getByText('peri-studio')).toBeInTheDocument();
    expect(message).toHaveValue('  Ship remote SCM  ');

    await fireEvent.click(screen.getByRole('button', { name: 'Pull from upstream' }));
    const pull = sent.filter((frame) => (frame as { payload?: { action?: string } }).payload?.action === 'pull').at(-1) as { requestId: string };
    handleResourceResult({ t: 'resource_result', requestId: pull.requestId, result: { kind: 'mutated' } });
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue('  Ship remote SCM  '));

    setResourceWorkspace((current) => ({ ...current, repositories: [repository] }));
    const reviewedMessage = screen.getByRole('textbox', { name: 'Commit message' });
    await fireEvent.input(reviewedMessage, { target: { value: 'Ship after review' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Commit staged changes' }));
    const successful = sent.filter((frame) => (frame as { type?: string }).type === 'resource/git-action').at(-1) as { requestId: string };
    await fireEvent.click(screen.getByRole('button', { name: 'Explorer' }));
    handleResourceResult({
      t: 'resource_result', requestId: successful.requestId, result: { kind: 'mutated' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Source Control' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue(''));
  });

  it('requires confirmation before discarding a change', async () => {
    const sent: unknown[] = [];
    installResourceStore({ send: (frame) => { sent.push(frame); return true; }, ready: () => true, toast: vi.fn() });
    installPrincipalRole('full');
    setResourceWorkspace({
      projectId: 'project-1', directories: {}, loading: [], error: null,
      repositories: [{
        id: 'repo-1', root: '', name: 'peri-studio', headName: 'main', generation: 'g1',
        groups: { working_tree: { count: 1, revision: 'r1', changes: [{ id: 'c1', path: 'src/main.ts', status: 'modified' }] } },
      }],
    });
    render(() => <SourceControlPanel />);

    await fireEvent.click(screen.getByRole('button', { name: 'Discard src/main.ts' }));
    expect(screen.getByRole('dialog', { name: 'Discard changes' })).toBeInTheDocument();
    expect(sent).toHaveLength(0);
    await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(sent).toContainEqual(expect.objectContaining({
      payload: { repoId: 'repo-1', action: 'discard', changeIds: ['c1'], expectedGeneration: 'g1' },
    }));
  });

  it('offers non-interactive pull, push and sync actions from ahead/behind state', async () => {
    const sent: unknown[] = [];
    installResourceStore({ send: (frame) => { sent.push(frame); return true; }, ready: () => true, toast: vi.fn() });
    installPrincipalRole('full');
    setResourceWorkspace({
      projectId: 'project-1', directories: {}, loading: [], error: null,
      repositories: [{ id: 'repo-1', root: '', name: 'peri-studio', headName: 'main', upstream: 'origin/main', generation: 'g1', ahead: 1, behind: 2, groups: {} }],
    });
    render(() => <SourceControlPanel />);

    expect(screen.getByRole('button', { name: 'Pull from upstream' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Push to upstream' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Synchronize changes' }));
    expect(sent).toContainEqual(expect.objectContaining({
      payload: { repoId: 'repo-1', action: 'sync', changeIds: [], expectedGeneration: 'g1' },
    }));
  });

  it('keeps an interleaved mutation in another repository when the first repository refreshes', () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: { repoId?: string } }> = [];
    installResourceStore({ send: (frame) => { sent.push(frame as typeof sent[number]); return true; }, ready: () => true, toast: vi.fn() });
    setResourceWorkspace({
      projectId: 'project-1', directories: {}, loading: [], error: null,
      repositories: [
        { id: 'repo-1', root: 'one', name: 'one', generation: 'g1', groups: { working_tree: { count: 1, revision: 'r1', changes: [{ id: 'c1', path: 'one.ts' }] } } },
        { id: 'repo-2', root: 'two', name: 'two', generation: 'g2', groups: { working_tree: { count: 1, revision: 'r2', changes: [{ id: 'c2', path: 'two.ts' }] } } },
      ],
    });
    expect(mutateGitResource('repo-1', 'stage', ['c1'])).toBe(true);
    expect(mutateGitResource('repo-2', 'stage', ['c2'])).toBe(true);
    const first = sent.find((frame) => frame.type === 'resource/git-action' && frame.payload?.repoId === 'repo-1')!;
    const second = sent.find((frame) => frame.type === 'resource/git-action' && frame.payload?.repoId === 'repo-2')!;

    handleResourceResult({ t: 'resource_result', requestId: first.requestId!, result: { kind: 'mutated' } });
    expect(resourceWorkspace().mutations?.c2?.pending).toBe(true);
    expect(resourceWorkspace().repositories.find((repo) => repo.id === 'repo-2')?.groups.working_tree.count).toBe(1);
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'resource/open-view', payload: expect.objectContaining({ repoId: 'repo-1', kind: 'git-repository' }),
    }));

    handleResourceResult({
      t: 'resource_result', requestId: second.requestId!,
      error: { code: 'UNAVAILABLE', message: 'Repository two failed', retryable: true },
    });
    expect(resourceWorkspace().mutations?.c2).toEqual(expect.objectContaining({ pending: false, error: 'Repository two failed' }));
  });

  it('reopens short-lived resource views after reconnect instead of replaying stale doc ids', () => {
    const sent: Array<Record<string, unknown>> = [];
    installResourceStore({ send: (frame) => { sent.push(frame as Record<string, unknown>); return true; }, ready: () => true, toast: vi.fn() });
    activateResourceProject('project-1');
    const request = sent.find((frame) => frame.type === 'resource/open-view')!;
    handleResourceResult({
      t: 'resource_result', requestId: request.requestId as string,
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
