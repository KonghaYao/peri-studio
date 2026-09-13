import { describe, expect, it } from 'vitest';
import { sessionArchiveLooksLoading } from './session-archive-state';

const base = {
  sessionId: 'acp-1',
  lifecycle: 'ready',
  activeChatId: 'chat-live' as string | null,
  openingSessionId: null as string | null,
  selectedSessionId: 'acp-1',
  selectedChatId: 'chat-live',
  chatStatuses: { 'chat-live': 'accepting' },
  chatTurnActive: {} as Record<string, boolean>,
  selectedTurnActive: false,
};

describe('sessionArchiveLooksLoading', () => {
  it('blocks archive while the agent turn is still active', () => {
    expect(sessionArchiveLooksLoading({
      ...base,
      selectedTurnActive: true,
    })).toBe(true);
  });

  it('blocks archive for a non-selected session whose runtime turn is still active', () => {
    expect(sessionArchiveLooksLoading({
      ...base,
      selectedSessionId: 'other-session',
      selectedChatId: 'chat-other',
      chatTurnActive: { 'chat-live': true },
    })).toBe(true);
  });

  it('allows archive when the runtime is idle even if Registry still projects accepting', () => {
    expect(sessionArchiveLooksLoading(base)).toBe(false);
  });

  it('allows archive when Registry has not projected the runtime status yet', () => {
    expect(sessionArchiveLooksLoading({
      ...base,
      chatStatuses: {},
    })).toBe(false);
  });

  it('does not treat a leftover Control Doc turn as loading after the runtime hint is gone', () => {
    expect(sessionArchiveLooksLoading({
      ...base,
      activeChatId: null,
      selectedChatId: null,
      chatStatuses: { 'chat-live': 'ended' },
      selectedTurnActive: true,
    })).toBe(false);
  });

  it('does not treat gap (no process evidence) as loading', () => {
    expect(sessionArchiveLooksLoading({
      ...base,
      chatStatuses: { 'chat-live': 'gap' },
      selectedTurnActive: true,
    })).toBe(false);
  });

  it('does not treat pending_close as loading', () => {
    expect(sessionArchiveLooksLoading({
      ...base,
      chatStatuses: { 'chat-live': 'pending_close' },
      selectedTurnActive: true,
    })).toBe(false);
  });

  it('still blocks while the session is opening and no live runtime is projected yet', () => {
    expect(sessionArchiveLooksLoading({
      ...base,
      activeChatId: null,
      selectedChatId: null,
      openingSessionId: 'acp-1',
    })).toBe(true);
  });

  it('does not block opening when a live runtime is already projected', () => {
    expect(sessionArchiveLooksLoading({
      ...base,
      openingSessionId: 'acp-1',
    })).toBe(false);
  });

  it('blocks while catalog lifecycle is still activating', () => {
    expect(sessionArchiveLooksLoading({
      ...base,
      lifecycle: 'activating',
    })).toBe(true);
  });
});
