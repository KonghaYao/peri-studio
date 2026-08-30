import { describe, expect, it, vi } from 'vitest';
import { DocStore } from './doc-store';
import * as H from './protocol';
import { installChatSubscription, refreshCurrentControlProjection, selectChat } from './chat-subscription';
import { installMcpApps, liveMcpApp, openMcpApp, resetMcpAppsState } from './mcp-apps';
import { setPrincipalRole } from './auth-state';

describe('chat subscription control refresh', () => {
  it('drops and re-subscribes only the current Control Doc', () => {
    const store = new DocStore();
    const original = store.docFor(H.sessionDoc('chat-1'));
    const sendFrame = vi.fn(() => true);
    const setChatHead = vi.fn();
    const setPermissions = vi.fn();
    const setElicitations = vi.fn();
    let runtimeState = { chat: true, control: true };
    const setRuntimeDocsState = vi.fn((update) => {
      runtimeState = typeof update === 'function' ? update(runtimeState) : update;
    });
    installChatSubscription({
      getCurrentCid: () => 'chat-1', setCurrentCid: vi.fn(), docStore: store, sendFrame, toast: vi.fn(),
      chatStatusSignal: () => ({}), chatHead: () => null, setSelectedCid: vi.fn(), setChatEntries: vi.fn(),
      setChatHead, setPermissions, setElicitations, setRuntimeDocsState,
    });

    expect(refreshCurrentControlProjection()).toBe(true);
    expect(sendFrame.mock.calls).toEqual([
      [H.unsubscribe([H.sessionDoc('chat-1')])],
      [H.subscribe([H.sessionDoc('chat-1')])],
    ]);
    expect(store.docFor(H.sessionDoc('chat-1'))).not.toBe(original);
    expect(setChatHead).toHaveBeenCalledWith(null);
    expect(setPermissions).toHaveBeenCalledWith([]);
    expect(setElicitations).toHaveBeenCalledWith([]);
    expect(setRuntimeDocsState).toHaveBeenCalledOnce();
    expect(runtimeState).toEqual({ chat: true, control: false });
  });

  it('selectChat tears down MCP apps for the previous chat', () => {
    setPrincipalRole('full');
    let currentCid: string | null = 'chat-1';
    installMcpApps({
      selectedCid: () => currentCid,
      ready: () => true,
      sendAction: vi.fn(() => true),
      acknowledge: vi.fn(),
    });
    openMcpApp('chat-1', 'tool-1', {}, {});
    expect(liveMcpApp('tool-1')).not.toBeNull();

    const store = new DocStore();
    installChatSubscription({
      getCurrentCid: () => currentCid,
      setCurrentCid: (cid) => { currentCid = cid; },
      docStore: store,
      sendFrame: vi.fn(() => true),
      toast: vi.fn(),
      chatStatusSignal: () => ({}),
      chatHead: () => null,
      setSelectedCid: vi.fn(),
      setChatEntries: vi.fn(),
      setChatHead: vi.fn(),
      setPermissions: vi.fn(),
      setElicitations: vi.fn(),
      setRuntimeDocsState: vi.fn(),
    });

    selectChat('chat-2');
    expect(liveMcpApp('tool-1')).toBeNull();
    resetMcpAppsState();
    setPrincipalRole(null);
  });
});
