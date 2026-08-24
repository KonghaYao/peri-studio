import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
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

  it('delivers stable entry identities when only the streaming tail changes', () => {
    const store = new DocStore();
    const projected = signals();
    installStoreProjection(store, () => 'chat-1', projected, vi.fn(), vi.fn(), vi.fn());
    const root = store.docFor('chat:chat-1').getMap<unknown>('root');
    const entries = new Y.Map<unknown>();
    const order = new Y.Array<string>();
    const tail = new Y.Text();
    root.set('entries', entries);
    root.set('entry_order', order);
    root.set('tool_calls', new Y.Map<unknown>());
    for (const [id, textValue] of [['first', 'one'], ['tail', 'two']] as const) {
      const entry = new Y.Map<unknown>(); const blocks = new Y.Map<unknown>();
      const blockOrder = new Y.Array<string>(); const block = new Y.Map<unknown>();
      const text = id === 'tail' ? tail : new Y.Text();
      entries.set(id, entry); order.push([id]); entry.set('role', 'assistant'); entry.set('turn_id', id);
      entry.set('created_at', '2026-08-24T00:00:00Z'); entry.set('blocks', blocks); entry.set('block_order', blockOrder);
      blocks.set(`${id}:text`, block); blockOrder.push([`${id}:text`]); block.set('kind', 'text'); block.set('text', text);
      text.insert(0, textValue);
    }
    store.onUpdate?.('chat:chat-1');
    const initial = projected.setChatEntries.mock.calls[0]?.[0];

    tail.insert(tail.length, ' streamed');
    store.onUpdate?.('chat:chat-1');
    const updated = projected.setChatEntries.mock.calls[1]?.[0];

    expect(updated[0]).toBe(initial[0]);
    expect(updated[1]).not.toBe(initial[1]);
    expect(updated[1].text).toBe('two streamed');
  });
});
