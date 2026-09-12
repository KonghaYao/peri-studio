import { describe, expect, it } from 'vitest';
import { isLiveRuntimeStatus, retainLiveRuntimeHints } from './recovery-state.ts';

const chat = (id: string, status: string | null) => ({ id, status });

const session = (activeChatId: string | null) => ({
  id: 'hub-abcdef12',
  projectId: 'p1',
  title: 'Session',
  lifecycle: 'ready',
  updatedAt: '2026-08-13T10:00:00Z',
  lastOpenedAt: null,
  activeChatId,
  acpSessionId: 'acp-12345678',
  archivedAt: null,
});

describe('retainLiveRuntimeHints', () => {
  it('keeps the hint for an accepting (running) runtime chat', () => {
    const result = retainLiveRuntimeHints([session('chat-live')], [chat('chat-live', 'accepting')]);
    expect(result[0].activeChatId).toBe('chat-live');
  });

  it('drops the hint when the chat is terminal (ended/closed/crashed)', () => {
    for (const status of ['ended', 'closed', 'crashed']) {
      const result = retainLiveRuntimeHints([session('chat-x')], [chat('chat-x', status)]);
      expect(result[0].activeChatId, status).toBeNull();
    }
  });

  it('drops the hint when the chat is gapped (no live process evidence)', () => {
    // §8.3 对账 missing → server 置 gap：进程已死，会话不再显示「运行中」。
    const result = retainLiveRuntimeHints([session('chat-gap')], [chat('chat-gap', 'gap')]);
    expect(result[0].activeChatId).toBeNull();
  });

  it('treats ended/closed/crashed/gap as non-live runtime statuses', () => {
    expect(isLiveRuntimeStatus('accepting')).toBe(true);
    expect(isLiveRuntimeStatus('gap')).toBe(false);
    expect(isLiveRuntimeStatus('ended')).toBe(false);
    expect(isLiveRuntimeStatus('closed')).toBe(false);
    expect(isLiveRuntimeStatus('crashed')).toBe(false);
  });

  it('keeps the hint when the chat status is unknown (conservative)', () => {
    const result = retainLiveRuntimeHints([session('chat-unknown')], [chat('chat-unknown', null)]);
    expect(result[0].activeChatId).toBe('chat-unknown');
  });

  it('reuses a terminal projection while the source session stays unchanged', () => {
    const source = [session('chat-ended')];
    const first = retainLiveRuntimeHints(source, [chat('chat-ended', 'ended')]);
    const second = retainLiveRuntimeHints(source, [chat('chat-ended', 'ended')], first);

    expect(first[0].activeChatId).toBeNull();
    expect(second).toBe(first);
    expect(second[0]).toBe(first[0]);
  });
});
