import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExplorerPanel } from './ExplorerPanel';
import { SourceControlPanel } from './SourceControlPanel';
import { installResourceStore, resetResourceProject, setResourceWorkspace } from '../lib/resource-store';
import { installPrincipalRole } from '../lib/auth-state';

afterEach(() => { cleanup(); resetResourceProject(); installPrincipalRole(null); });

describe('VS Code-style resource panels', () => {
  it('lazy-loads a directory when its tree row expands', async () => {
    const sent: unknown[] = [];
    installResourceStore({ send: (frame) => { sent.push(frame); return true; }, ready: () => true, toast: vi.fn() });
    setResourceWorkspace({
      projectId: 'project-1',
      directories: { '': { generation: 'g1', entries: [{ id: 'src', name: 'src', path: 'src', kind: 'directory' }] } },
      repositories: [], loading: [], error: null,
    });
    render(() => <ExplorerPanel />);
    await fireEvent.click(screen.getByRole('treeitem', { name: /src/i }));
    expect(sent).toContainEqual(expect.objectContaining({
      t: 'resource_query', type: 'resource/open-view', projectId: 'project-1',
      payload: expect.objectContaining({ kind: 'fs-directory-page', path: 'src' }),
    }));
  });

  it('renders repository branch, SCM groups and compact status decorations', () => {
    const sent: unknown[] = [];
    installResourceStore({ send: (frame) => { sent.push(frame); return true; }, ready: () => true, toast: vi.fn() });
    installPrincipalRole('full');
    setResourceWorkspace({
      projectId: 'project-1', directories: {}, loading: [], error: null,
      repositories: [{
        id: 'repo-1', root: '', name: 'peri-studio', headName: 'main', generation: 'g1', groups: {
          working_tree: { count: 1, revision: 'r1', changes: [{ id: 'c1', path: 'src/main.ts', status: 'modified' }] },
        },
      }],
    });
    render(() => <SourceControlPanel />);
    expect(screen.getByText('peri-studio')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('Changes')).toBeInTheDocument();
    expect(screen.getByText('main.ts')).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stage src/main.ts' }));
    expect(sent).toContainEqual(expect.objectContaining({
      t: 'resource_query', type: 'resource/git-action', projectId: 'project-1',
      payload: { repoId: 'repo-1', action: 'stage', paths: ['src/main.ts'], expectedGeneration: 'g1' },
    }));
  });
});
