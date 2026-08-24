import { describe, expect, it, vi } from 'vitest';
import { DocStore } from './doc-store';
import { installStoreProjection } from './store-projection';

function signals() {
  return {
    setChatEntries: vi.fn(), setChatHead: vi.fn(), setPermissions: vi.fn(),
    setElicitations: vi.fn(), setElicitationResponses: vi.fn(), setProjects: vi.fn(),
    setRegistryHydrated: vi.fn(), setProjectSessions: vi.fn(), setImportableSessions: vi.fn(),
    setInstances: vi.fn(), setChatCatalog: vi.fn(), setGlobalStatus: vi.fn(),
    setSchemaVersion: vi.fn(), setChatStatusSignal: vi.fn(), setRuntimeDocsState: vi.fn(),
  };
}

describe('store projection progress seam', () => {
  it('reports accepted chat and control document progress for the selected runtime', () => {
    const store = new DocStore();
    const progress = vi.fn();
    installStoreProjection(store, () => 'chat-1', signals(), vi.fn(), vi.fn(), progress);

    store.onUpdate?.('chat:chat-1');
    store.onUpdate?.('session:chat-1');

    expect(progress.mock.calls).toEqual([['chat-1'], ['chat-1']]);
  });
});
