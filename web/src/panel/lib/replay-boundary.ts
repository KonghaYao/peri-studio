import type { ChatEntry } from '@/entities/chat/chat-view';

export type ReplayBoundary = 'verified_history' | 'inferred_history' | 'live_runtime' | null;

/** One structural divider per provenance segment; legacy/unknown entries stay quiet. */
export function replayBoundaryAt(entries: ChatEntry[], index: number): ReplayBoundary {
  const current = entries[index];
  if (!current) return null;
  const previous = index > 0 ? entries[index - 1] : null;
  if (current.origin === 'session_replay' && previous?.origin !== 'session_replay') {
    let end = index;
    while (entries[end]?.origin === 'session_replay') end += 1;
    const verified = entries.slice(index, end).every((entry) => entry.replayVerified === true);
    return verified ? 'verified_history' : 'inferred_history';
  }
  if (current.origin !== 'session_replay' && previous?.origin === 'session_replay') {
    return 'live_runtime';
  }
  return null;
}
