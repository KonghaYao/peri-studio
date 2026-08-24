import { describe, expect, it, vi } from 'vitest';
import { DocStore } from './doc-store';
import * as H from './protocol';
import { installChatSubscription, refreshCurrentControlProjection } from './chat-subscription';

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
});
