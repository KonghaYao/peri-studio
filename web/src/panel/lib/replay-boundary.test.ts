import { describe, expect, it } from 'vitest';
import type { ChatEntry } from './chat-view';
import { replayBoundaryAt } from './replay-boundary';

function entry(origin: NonNullable<ChatEntry['origin']> | null, replayVerified: boolean | null): ChatEntry {
  return {
    id: crypto.randomUUID(), turnId: null, kind: 'message', role: 'assistant', status: 'completed', authorUserId: null,
    sourceCommandId: null, origin, replayVerified, createdAt: '', completedAt: null, text: '', reasoning: [], toolCalls: [], resources: [], error: null,
  };
}

describe('replayBoundaryAt', () => {
  it('marks one verified history segment and the transition to live runtime', () => {
    const entries = [entry('session_replay', true), entry('session_replay', true), entry('live', null)];
    expect(entries.map((_, index) => replayBoundaryAt(entries, index))).toEqual([
      'verified_history', null, 'live_runtime',
    ]);
  });

  it('degrades the whole replay segment when any producer evidence is missing', () => {
    const entries = [entry('session_replay', true), entry('session_replay', false)];
    expect(replayBoundaryAt(entries, 0)).toBe('inferred_history');
  });

  it('adds no provenance decoration to legacy unknown history', () => {
    expect(replayBoundaryAt([entry(null, null)], 0)).toBeNull();
  });
});
