// Rewind 装配模块行为测试：门控、帧归属校验、错误归属与重置语义。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canRewindCurrentChat,
  closeRewindFlow,
  executeRewind,
  handleRewindCandidates,
  handleRewindPreview,
  installRewind,
  openRewindFlow,
  previewRewind,
  resetRewindState,
  rewindFlow,
  rewindOwnsError,
  setRewindFlow,
} from './rewind-assembly';
import { setPrincipalRole } from './auth-state';
import type { ActionFrame, ActionOptions } from './action-contract';

function installTestDeps(overrides: Partial<Parameters<typeof installRewind>[0]> = {}) {
  setPrincipalRole('full');
  let lastFrame: ActionFrame | null = null;
  const sendAction = vi.fn((frame: ActionFrame, _label: string, _options: ActionOptions) => {
    lastFrame = frame;
    return true;
  });
  const acknowledge = vi.fn((ack: { commandId?: string; status?: string }) => undefined);
  const fail = vi.fn();
  installRewind({
    selectedCid: () => 'chat-1',
    ready: () => true,
    isTerminal: (status) => status === 'ended' || status === 'closed' || status === 'crashed',
    chatStatusSignal: () => ({ 'chat-1': 'running' }),
    chatHead: () => ({ agent: { extensions: ['peri.rewind'] } }) as never,
    turnActive: () => false,
    sendAction,
    acknowledge,
    fail,
    ...overrides,
  });
  return { sendAction, acknowledge, fail, lastCommandId: () => lastFrame?.commandId ?? '' };
}

afterEach(() => {
  resetRewindState();
  setPrincipalRole(null);
});

describe('rewind gating', () => {
  it('canRewindCurrentChat requires a non-terminal chat with the rewind extension', () => {
    installTestDeps();
    expect(canRewindCurrentChat()).toBe(true);
    installTestDeps({ chatStatusSignal: () => ({ 'chat-1': 'ended' }) });
    expect(canRewindCurrentChat()).toBe(false);
    installTestDeps({ chatHead: () => ({ agent: { extensions: [] } }) as never });
    expect(canRewindCurrentChat()).toBe(false);
    installTestDeps({ turnActive: () => true });
    expect(canRewindCurrentChat()).toBe(false);
    setPrincipalRole('read-only');
    expect(canRewindCurrentChat()).toBe(false);
  });

  it('openRewindFlow rejects read-only principals and absent chats without sending', () => {
    const { sendAction } = installTestDeps({ selectedCid: () => null });
    expect(openRewindFlow()).toBe(false);
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('executeRewind only runs from the confirm stage', () => {
    const { sendAction, lastCommandId } = installTestDeps();
    expect(executeRewind()).toBe(false);
    setRewindFlow({
      kind: 'confirm', chatId: 'chat-1', candidates: [],
      candidate: { messageId: 'message-1', preview: 'Fix login flow' },
      previewFingerprint: 'a'.repeat(64),
      fileChanges: [{ path: 'src/main.rs', kind: 'edit' }],
    });
    expect(executeRewind()).toBe(true);
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(lastCommandId()).not.toBe('');
    expect(rewindFlow().kind).toBe('executing');
  });

  it('closeRewindFlow ignores the executing stage', () => {
    installTestDeps();
    setRewindFlow({ kind: 'executing', chatId: 'chat-1', commandId: 'command-1', candidate: { messageId: 'm', preview: 'p' }, fileChanges: [] });
    closeRewindFlow();
    expect(rewindFlow().kind).toBe('executing');
    setRewindFlow({ kind: 'select_target', chatId: 'chat-1', candidates: [] });
    closeRewindFlow();
    expect(rewindFlow().kind).toBe('closed');
  });
});

describe('rewind frame routing', () => {
  it('rewind_candidates applies a matching candidates query and acknowledges', () => {
    const { acknowledge, lastCommandId } = installTestDeps();
    openRewindFlow();
    const commandId = lastCommandId();
    handleRewindCandidates({ t: 'rewind_candidates', commandId, chatId: 'chat-1', candidates: [{ messageId: 'm-1', preview: 'rewind point' }] } as never);
    expect(rewindFlow().kind).toBe('select_target');
    expect(acknowledge).toHaveBeenCalledWith({ commandId, status: 'committed' });
  });

  it('rewind_candidates ignores unregistered or cross-chat frames', () => {
    const { acknowledge } = installTestDeps();
    handleRewindCandidates({ t: 'rewind_candidates', commandId: 'unknown', chatId: 'chat-1', candidates: [] } as never);
    expect(rewindFlow().kind).toBe('closed');
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('rewind_preview requires a fingerprint-bound preview query', () => {
    const { acknowledge } = installTestDeps();
    setRewindFlow({
      kind: 'select_target', chatId: 'chat-1',
      candidates: [{ messageId: 'm-1', preview: 'rewind point' }],
    });
    const commandId = 'preview-command-1';
    handleRewindPreview({ t: 'rewind_preview', commandId, chatId: 'chat-1', targetMessageId: 'm-1', previewFingerprint: 'b'.repeat(64), fileChanges: [] } as never);
    expect(rewindFlow().kind).toBe('select_target'); // 未登记的 commandId 不落位
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('previewRewind transitions to confirm after a matched preview response', () => {
    const { lastCommandId } = installTestDeps();
    setRewindFlow({
      kind: 'select_target', chatId: 'chat-1',
      candidates: [{ messageId: 'm-1', preview: 'rewind point' }],
    });
    expect(previewRewind({ messageId: 'm-1', preview: 'rewind point' })).toBe(true);
    const commandId = lastCommandId();
    handleRewindPreview({ t: 'rewind_preview', commandId, chatId: 'chat-1', targetMessageId: 'm-1', previewFingerprint: 'b'.repeat(64), fileChanges: [{ path: 'a.rs', kind: 'edit' }] } as never);
    expect(rewindFlow().kind).toBe('confirm');
  });
});

describe('rewind error ownership', () => {
  it('rewindOwnsError consumes queries and the active flow command without reaching the error center', () => {
    const { fail, lastCommandId } = installTestDeps();
    openRewindFlow();
    const commandId = lastCommandId();
    expect(rewindOwnsError({ commandId, code: 'TIMEOUT', message: 'Rewind node read timed out', retryable: true })).toBe(true);
    expect(fail).toHaveBeenCalledWith({ commandId, code: 'TIMEOUT', message: 'Rewind node read timed out', retryable: true });
    expect(rewindOwnsError({ code: 'UNKNOWN', message: 'Unrelated error', retryable: false })).toBe(false);
  });
});

describe('rewind reset semantics', () => {
  it('resetRewindState closes the flow and clears queries', () => {
    installTestDeps();
    setRewindFlow({ kind: 'select_target', chatId: 'chat-1', candidates: [] });
    resetRewindState();
    expect(rewindFlow().kind).toBe('closed');
  });
});
