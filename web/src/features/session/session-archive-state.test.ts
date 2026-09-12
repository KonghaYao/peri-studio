import { describe, expect, it } from 'vitest';
import { sessionArchiveLooksLoading } from './session-archive-state';

const base = {
  sessionId: 'acp-1',
  lifecycle: 'ready',
  activeChatId: 'chat-live' as string | null,
  openingSessionId: null as string | null,
  selectedSessionId: 'acp-1',
  chatStatuses: { 'chat-live': 'accepting' },
  selectedTurnActive: true,
};

describe('sessionArchiveLooksLoading', () => {
  it('blocks archive while the selected live runtime still has an active turn', () => {
    expect(sessionArchiveLooksLoading(base)).toBe(true);
  });

  it('does not treat a leftover Control Doc turn as loading after the runtime hint is gone', () => {
    expect(sessionArchiveLooksLoading({
      ...base,
      activeChatId: null,
      chatStatuses: { 'chat-live': 'ended' },
    })).toBe(false);
  });

  it('does not treat gap (no process evidence) as loading', () => {
    expect(sessionArchiveLooksLoading({
      ...base,
      chatStatuses: { 'chat-live': 'gap' },
    })).toBe(false);
  });

  it('still blocks while the session is opening', () => {
    expect(sessionArchiveLooksLoading({
      ...base,
      activeChatId: null,
      selectedTurnActive: false,
      openingSessionId: 'acp-1',
    })).toBe(true);
  });
});
