import { describe, expect, it, vi } from 'vitest';
import { openWorkspaceFromTool } from './open-workspace-from-tool';

describe('openWorkspaceFromTool', () => {
  it('activates the session project before opening explorer preview', () => {
    const requestWorkbench = vi.fn();
    const openFilePreview = vi.fn();
    const activateResourceProject = vi.fn();

    openWorkspaceFromTool('web/src/main.ts', {
      projectId: () => 'project-1',
      projectCwd: () => '/repo',
      activateResourceProject,
      requestWorkbench,
      openFilePreview,
    });

    expect(activateResourceProject).toHaveBeenCalledWith('project-1');
    expect(requestWorkbench).toHaveBeenCalledWith(expect.objectContaining({
      view: 'explorer',
      activePath: 'web/src/main.ts',
    }));
    expect(openFilePreview).toHaveBeenCalledWith('web/src/main.ts');
  });

  it('ignores paths that cannot be normalized', () => {
    const requestWorkbench = vi.fn();
    const openFilePreview = vi.fn();
    const activateResourceProject = vi.fn();

    openWorkspaceFromTool('', {
      projectId: () => 'project-1',
      projectCwd: () => '/repo',
      activateResourceProject,
      requestWorkbench,
      openFilePreview,
    });

    expect(activateResourceProject).not.toHaveBeenCalled();
    expect(requestWorkbench).not.toHaveBeenCalled();
    expect(openFilePreview).not.toHaveBeenCalled();
  });

  it('does not open preview without a session project id', () => {
    const requestWorkbench = vi.fn();
    const openFilePreview = vi.fn();
    const activateResourceProject = vi.fn();

    openWorkspaceFromTool('web/src/main.ts', {
      projectId: () => undefined,
      projectCwd: () => '/repo',
      activateResourceProject,
      requestWorkbench,
      openFilePreview,
    });

    expect(activateResourceProject).not.toHaveBeenCalled();
    expect(requestWorkbench).not.toHaveBeenCalled();
    expect(openFilePreview).not.toHaveBeenCalled();
  });
});
