// PromptRecovery 装配模块行为测试：核对流程、帧归属、错误归属与重置语义。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPromptRecoverySelection,
  handlePromptStatus,
  installPromptRecovery,
  promptRecovery,
  promptRecoveryOwnsError,
  refreshPromptRecovery,
  requestPromptRecovery,
  resetPromptRecoveryState,
  setPromptRecovery,
} from './prompt-recovery-assembly';
import type { ActionFrame, ActionOptions } from './action-contract';

function installTestDeps(overrides: Partial<Parameters<typeof installPromptRecovery>[0]> = {}) {
  let lastFrame: ActionFrame | null = null;
  const sendAction = vi.fn((frame: ActionFrame, _label: string, _options: ActionOptions) => {
    lastFrame = frame;
    return true;
  });
  const acknowledge = vi.fn((ack: { commandId?: string; status?: string }) => undefined);
  const fail = vi.fn();
  installPromptRecovery({
    selectedSessionId: () => 'session-1',
    ready: () => true,
    sendAction,
    acknowledge,
    fail,
    ...overrides,
  });
  return { sendAction, acknowledge, fail, lastCommandId: () => lastFrame?.commandId ?? '' };
}

afterEach(() => {
  resetPromptRecoveryState();
});

describe('prompt recovery flow', () => {
  it('requestPromptRecovery begins a query and skips an in-flight current', () => {
    const { sendAction } = installTestDeps();
    requestPromptRecovery('session-1');
    expect(promptRecovery()?.loading).toBe(true);
    expect(sendAction).toHaveBeenCalledTimes(1);
    requestPromptRecovery('session-1'); // 已有 current 查询，不重复发
    expect(sendAction).toHaveBeenCalledTimes(1);
  });

  it('requestPromptRecovery is gated by readiness', () => {
    const { sendAction } = installTestDeps({ ready: () => false });
    requestPromptRecovery('session-1');
    expect(sendAction).not.toHaveBeenCalled();
    expect(promptRecovery()).toBeNull();
  });

  it('refreshPromptRecovery reports unreadiness instead of querying', () => {
    const { sendAction } = installTestDeps({ ready: () => false });
    refreshPromptRecovery();
    expect(sendAction).not.toHaveBeenCalled();
    expect(promptRecovery()?.error).toContain('Connection not ready');
  });

  it('handlePromptStatus settles the current query with matching session evidence', () => {
    const { acknowledge, lastCommandId } = installTestDeps();
    requestPromptRecovery('session-1');
    const commandId = lastCommandId();
    const response = {
      commandId, sessionId: 'session-1', truncated: true, evidenceIncomplete: false,
      prompts: [{ commandId: 'p-1', status: 'projected', text: 'hi' } as never],
    };
    handlePromptStatus({ t: 'prompt_status', ...response } as never);
    expect(promptRecovery()?.checkedAt).not.toBeNull();
    expect(promptRecovery()?.truncated).toBe(true);
    expect(acknowledge).toHaveBeenCalledWith({ commandId, status: 'committed' });
  });

  it('handlePromptStatus ignores unsolicited frames and cross-session responses', () => {
    const { acknowledge } = installTestDeps();
    handlePromptStatus({ t: 'prompt_status', commandId: 'unknown', sessionId: 'session-1', truncated: false, evidenceIncomplete: false, prompts: [] } as never);
    expect(promptRecovery()).toBeNull();
    expect(acknowledge).not.toHaveBeenCalled();
    requestPromptRecovery('session-1');
    handlePromptStatus({ t: 'prompt_status', commandId: 'unknown', sessionId: 'session-2', truncated: false, evidenceIncomplete: false, prompts: [] } as never);
    expect(promptRecovery()?.checkedAt).toBeNull();
  });

  it('promptRecoveryOwnsError consumes query errors without reaching the error center', () => {
    const { fail, lastCommandId } = installTestDeps();
    requestPromptRecovery('session-1');
    const commandId = lastCommandId();
    expect(promptRecoveryOwnsError({ commandId, code: 'TIMEOUT', message: 'Verification request timed out', retryable: true })).toBe(true);
    expect(fail).toHaveBeenCalled();
    expect(promptRecoveryOwnsError({ code: 'UNKNOWN', message: 'Unrelated error', retryable: false })).toBe(false);
  });
});

describe('prompt recovery reset semantics', () => {
  it('clearPromptRecoverySelection cancels the current query and view', () => {
    installTestDeps();
    requestPromptRecovery('session-1');
    clearPromptRecoverySelection();
    expect(promptRecovery()).toBeNull();
  });

  it('resetPromptRecoveryState fully clears queries and view', () => {
    installTestDeps();
    setPromptRecovery({ sessionId: 'session-1', loading: false, refreshing: false, checkedAt: null, truncated: false, evidenceIncomplete: false, error: null, prompts: [] });
    resetPromptRecoveryState();
    expect(promptRecovery()).toBeNull();
  });
});
