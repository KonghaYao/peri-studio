import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateResourceProject,
  installResourceStore,
  refreshResourceProject,
  resourceWorkspace,
  resetResourceProject,
  setResourceWorkspace,
} from './resource-store';

afterEach(() => {
  resetResourceProject();
});

describe('refreshResourceProject', () => {
  it('keeps existing workspace data while marking the snapshot stale', () => {
    const send = vi.fn(() => true);
    installResourceStore({ send, ready: () => true, toast: vi.fn() });
    activateResourceProject('project-1');
    const callsAfterActivate = send.mock.calls.length;
    setResourceWorkspace((state) => ({
      ...state,
      directories: {
        '': {
          generation: 'g1',
          entries: [{ id: 'readme', name: 'README.md', path: 'README.md', kind: 'file' }],
        },
      },
    }));

    refreshResourceProject();

    expect(resourceWorkspace().projectId).toBe('project-1');
    expect(resourceWorkspace().directories['']?.entries).toEqual([
      { id: 'readme', name: 'README.md', path: 'README.md', kind: 'file' },
    ]);
    expect(resourceWorkspace().stale).toBe(true);
    expect(send.mock.calls.length).toBeGreaterThan(callsAfterActivate);
  });
});
