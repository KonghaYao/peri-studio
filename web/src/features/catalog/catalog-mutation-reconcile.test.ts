import { describe, expect, it, vi } from 'vitest';
import type { ProjectInfo, ProjectSessionInfo } from '@/entities/registry/registry-view';
import { catalogMutationProjected, reconcileCatalogMutations } from './catalog-mutation-reconcile';

const project = (overrides: Partial<ProjectInfo> = {}): ProjectInfo => ({
  id: 'p1',
  name: 'Peri',
  cwd: '/repo',
  instanceId: 'local',
  createdAt: null,
  updatedAt: null,
  archivedAt: null,
  ...overrides,
});

const session = (overrides: Partial<ProjectSessionInfo> = {}): ProjectSessionInfo => ({
  id: 's1',
  projectId: 'p1',
  title: 'Work',
  lifecycle: 'ready',
  updatedAt: null,
  lastOpenedAt: null,
  activeChatId: null,
  archivedAt: null,
  ...overrides,
});

describe('catalogMutationProjected', () => {
  it('treats a projected session archive as confirmed', () => {
    const frame = { commandId: 'cmd-1', type: 'session/archive', payload: { sessionId: 's1' } };
    expect(catalogMutationProjected(frame, [project()], [session()])).toBe(false);
    expect(catalogMutationProjected(frame, [project()], [session({ archivedAt: '2026-08-14T00:00:00Z' })])).toBe(true);
  });

  it('treats a projected session restore as confirmed', () => {
    const frame = { commandId: 'cmd-2', type: 'session/restore', payload: { sessionId: 's1' } };
    expect(catalogMutationProjected(frame, [project()], [session({ archivedAt: '2026-08-14T00:00:00Z' })])).toBe(false);
    expect(catalogMutationProjected(frame, [project()], [session()])).toBe(true);
  });
});

describe('reconcileCatalogMutations', () => {
  it('clears uncertain archive commands once registry shows the archived session', () => {
    const dismiss = vi.fn(() => true);
    const changed = reconcileCatalogMutations(
      [project()],
      [session({ archivedAt: '2026-08-14T00:00:00Z' })],
      [{ commandId: 'cmd-archive', type: 'session/archive', payload: { sessionId: 's1' } }],
      dismiss,
    );
    expect(changed).toBe(true);
    expect(dismiss).toHaveBeenCalledWith('cmd-archive');
  });

  it('ignores unrelated uncertain commands', () => {
    const dismiss = vi.fn(() => true);
    expect(reconcileCatalogMutations(
      [project()],
      [session()],
      [{ commandId: 'cmd-open', type: 'session/open', payload: { sessionId: 's1' } }],
      dismiss,
    )).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
  });
});
