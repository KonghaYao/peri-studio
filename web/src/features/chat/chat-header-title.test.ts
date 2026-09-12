import { describe, expect, it } from 'vitest';
import { resolveChatHeaderTitle } from './chat-header-title';

const session = {
  id: 'acp-1',
  projectId: 'project-1',
  title: 'Persistent session',
  lifecycle: 'ready' as const,
  updatedAt: null,
  lastOpenedAt: null,
  activeChatId: 'chat-1',
};

describe('resolveChatHeaderTitle', () => {
  it('prefers durable session title over runtime chat head', () => {
    expect(resolveChatHeaderTitle({
      sessions: [{ ...session, activeChatId: null }],
      selectedSessionId: session.id,
      chatHead: { chat: { chatId: 'chat-1', title: 'Runtime title', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null }, agent: null, activeTurn: null, pendingPermissions: [] },
    })).toBe('Persistent session');
  });

  it('disambiguates a fallback title with the durable ACP identity', () => {
    expect(resolveChatHeaderTitle({
      sessions: [{ ...session, title: 'New conversation', id: 'acp-12345678', activeChatId: null }],
      selectedSessionId: 'acp-12345678',
      chatHead: null,
    })).toBe('New conversation · …12345678');
  });

  it('falls back to runtime chat title when no session is selected', () => {
    expect(resolveChatHeaderTitle({
      sessions: [],
      selectedSessionId: null,
      chatHead: { chat: { chatId: 'chat-1', title: 'Runtime only', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null }, agent: null, activeTurn: null, pendingPermissions: [] },
    })).toBe('Runtime only');
  });

  it('uses the default label when no session or runtime title exists', () => {
    expect(resolveChatHeaderTitle({
      sessions: [],
      selectedSessionId: null,
      chatHead: null,
    })).toBe('New conversation');
  });
});
