import { describe, expect, it, vi } from 'vitest';
import { createSessionCatalogBootstrap } from './session-catalog-bootstrap';

describe('session-catalog-bootstrap', () => {
  it('discovers active projects sequentially after schedule', () => {
    const order: string[] = [];
    const pendingSnapshots: string[][] = [];
    const bootstrap = createSessionCatalogBootstrap({
      isReady: () => true,
      isReadOnly: () => false,
      activeProjectIds: () => ['p1', 'p2'],
      discover: (projectId, onSettled) => {
        order.push(projectId);
        onSettled();
        return true;
      },
      onPendingChange: (pending) => pendingSnapshots.push([...pending]),
    });

    bootstrap.schedule();
    expect(order).toEqual(['p1', 'p2']);
    expect(bootstrap.pending().size).toBe(0);
    expect(pendingSnapshots[0]).toEqual(['p1', 'p2']);
  });

  it('runs only once until reset', () => {
    const discover = vi.fn((_id: string, onSettled: () => void) => {
      onSettled();
      return true;
    });
    const bootstrap = createSessionCatalogBootstrap({
      isReady: () => true,
      isReadOnly: () => false,
      activeProjectIds: () => ['p1'],
      discover,
    });

    bootstrap.schedule();
    bootstrap.schedule();
    expect(discover).toHaveBeenCalledTimes(1);
    bootstrap.reset();
    bootstrap.schedule();
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it('skips when not ready', () => {
    const discover = vi.fn(() => true);
    const bootstrap = createSessionCatalogBootstrap({
      isReady: () => false,
      isReadOnly: () => false,
      activeProjectIds: () => ['p1'],
      discover,
    });
    bootstrap.schedule();
    expect(discover).not.toHaveBeenCalled();
  });
});
