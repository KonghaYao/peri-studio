import { describe, expect, it } from 'vitest';
import {
  readPinnedSessions,
  selectPinnedSessions,
  togglePinnedSession,
  writePinnedSessions,
  type SessionPin,
  type SessionPinStorage,
} from './session-pins';

class MemoryStorage implements SessionPinStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const pin = (projectId: string, sessionId: string): SessionPin => ({ projectId, sessionId });

const session = (projectId: string, id: string, lastOpenedAt: string) => ({
  projectId,
  id,
  title: id,
  lifecycle: 'ready',
  updatedAt: lastOpenedAt,
  lastOpenedAt,
  activeChatId: null,
});

describe('session pins', () => {
  it('persists pins per principal without exposing another principal’s choices', () => {
    const storage = new MemoryStorage();
    writePinnedSessions('principal-a', [pin('project-1', 'session-1')], storage);

    expect(readPinnedSessions('principal-a', storage)).toEqual([pin('project-1', 'session-1')]);
    expect(readPinnedSessions('principal-b', storage)).toEqual([]);
  });

  it('toggles a session without changing the order of the other pins', () => {
    const current = [pin('project-1', 'session-1'), pin('project-1', 'session-2')];
    const removed = togglePinnedSession(current, { projectId: 'project-1', id: 'session-1' });
    expect(removed).toEqual([pin('project-1', 'session-2')]);

    expect(togglePinnedSession(removed, { projectId: 'project-1', id: 'session-3' })).toEqual([
      pin('project-1', 'session-2'),
      pin('project-1', 'session-3'),
    ]);
  });

  it('renders pins in explicit order even when open timestamps change', () => {
    const sessions = [
      session('project-1', 'session-2', '2026-08-15T10:00:00Z'),
      session('project-1', 'session-1', '2026-08-16T10:00:00Z'),
    ];
    const pins = [pin('project-1', 'session-1'), pin('project-1', 'session-2')];

    expect(selectPinnedSessions(sessions, pins).map((item) => item.id)).toEqual(['session-1', 'session-2']);
  });

  it('ignores malformed persisted values instead of breaking the sidebar', () => {
    const storage = new MemoryStorage();
    writePinnedSessions('principal-a', [pin('project-1', 'session-1')], storage);
    storage.setItem('peri_studio:pinned_sessions:principal-a', '{broken');

    expect(readPinnedSessions('principal-a', storage)).toEqual([]);
  });
});
