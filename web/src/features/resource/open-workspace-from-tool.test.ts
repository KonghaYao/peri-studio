import { describe, expect, it, vi } from 'vitest';
import { openWorkspaceFromTool } from './open-workspace-from-tool';

describe('openWorkspaceFromTool', () => {
  it('normalizes path against cwd and opens explorer preview', () => {
    const requestWorkbench = vi.fn();
    const openFilePreview = vi.fn();

    openWorkspaceFromTool('web/src/main.ts', {
      projectCwd: () => '/repo',
      requestWorkbench,
      openFilePreview,
    });

    expect(requestWorkbench).toHaveBeenCalledWith(expect.objectContaining({
      view: 'explorer',
      activePath: 'web/src/main.ts',
    }));
    expect(openFilePreview).toHaveBeenCalledWith('web/src/main.ts');
  });

  it('ignores paths that cannot be normalized', () => {
    const requestWorkbench = vi.fn();
    const openFilePreview = vi.fn();

    openWorkspaceFromTool('', {
      projectCwd: () => '/repo',
      requestWorkbench,
      openFilePreview,
    });

    expect(requestWorkbench).not.toHaveBeenCalled();
    expect(openFilePreview).not.toHaveBeenCalled();
  });
});
