import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { DocStore } from './doc-store';
import { installStoreProjection } from './store-projection';

function signals() {
  return {
    setChatEntries: vi.fn(), setChatHead: vi.fn(), setPermissions: vi.fn(),
    setElicitations: vi.fn(), setQuestions: vi.fn(), setProjects: vi.fn(), setMachines: vi.fn(),
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

  it('does not republish project and session slices for an instance heartbeat', () => {
    const store = new DocStore();
    const projected = signals();
    installStoreProjection(store, () => null, projected, vi.fn(), vi.fn(), vi.fn());
    const root = store.docFor('hub:registry').getMap<unknown>('root');
    for (const section of ['instances', 'chats', 'sessions', 'workspaces', 'projects', 'project_sessions']) {
      root.set(section, new Y.Map<unknown>());
    }
    const instance = new Y.Map<unknown>();
    instance.set('hostname', 'local'); instance.set('status', 'online'); instance.set('last_heartbeat', 'first');
    (root.get('instances') as Y.Map<unknown>).set('local', instance);
    const project = new Y.Map<unknown>();
    project.set('name', 'Peri'); project.set('cwd', '/workspace'); project.set('instance_id', 'local');
    (root.get('projects') as Y.Map<unknown>).set('project-1', project);
    const session = new Y.Map<unknown>();
    session.set('project_id', 'project-1'); session.set('title', 'Draft'); session.set('lifecycle', 'ready');
    session.set('active_chat_id', 'chat-ended');
    (root.get('project_sessions') as Y.Map<unknown>).set('session-1', session);
    const chat = new Y.Map<unknown>();
    chat.set('status', 'ended');
    (root.get('chats') as Y.Map<unknown>).set('chat-ended', chat);
    store.onUpdate?.('hub:registry');
    const initialProjects = projected.setProjects.mock.calls[0]?.[0];
    const initialSessions = projected.setProjectSessions.mock.calls[0]?.[0];
    expect(initialSessions[0].activeChatId).toBeNull();

    instance.set('last_heartbeat', 'second');
    store.onUpdate?.('hub:registry');

    expect(projected.setProjects.mock.calls[1]?.[0]).toBe(initialProjects);
    expect(projected.setProjectSessions.mock.calls[1]?.[0]).toBe(initialSessions);
  });
});
