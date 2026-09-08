import type { RewindCandidate, RewindFileChange } from '@/shared/protocol/client';

export type RewindFlow =
  | { kind: 'closed' }
  | { kind: 'loading_candidates'; chatId: string; commandId: string }
  | { kind: 'select_target'; chatId: string; candidates: RewindCandidate[] }
  | { kind: 'loading_preview'; chatId: string; commandId: string; candidate: RewindCandidate; candidates: RewindCandidate[] }
  | { kind: 'confirm'; chatId: string; candidate: RewindCandidate; candidates: RewindCandidate[]; previewFingerprint: string; fileChanges: RewindFileChange[] }
  | { kind: 'executing'; chatId: string; commandId: string; candidate: RewindCandidate; fileChanges: RewindFileChange[] }
  | { kind: 'completed'; chatId: string }
  | { kind: 'delivery_unknown'; chatId: string; detail: string }
  | { kind: 'error'; chatId: string; stage: 'candidates' | 'preview' | 'execute'; detail: string; candidates: RewindCandidate[] };

export const closedRewindFlow = (): RewindFlow => ({ kind: 'closed' });

export function loadingRewindCandidates(chatId: string, commandId: string): RewindFlow {
  return { kind: 'loading_candidates', chatId, commandId };
}

export function receiveRewindCandidates(
  current: RewindFlow,
  response: { commandId: string; chatId: string; candidates: RewindCandidate[] },
): RewindFlow {
  if (current.kind !== 'loading_candidates' || current.commandId !== response.commandId
    || current.chatId !== response.chatId) return current;
  return { kind: 'select_target', chatId: current.chatId, candidates: response.candidates };
}

export function loadingRewindPreview(
  current: RewindFlow,
  commandId: string,
  candidate: RewindCandidate,
): RewindFlow {
  if (current.kind !== 'select_target') return current;
  return { kind: 'loading_preview', chatId: current.chatId, commandId, candidate, candidates: current.candidates };
}

export function receiveRewindPreview(
  current: RewindFlow,
  response: { commandId: string; chatId: string; targetMessageId: string; previewFingerprint: string; fileChanges: RewindFileChange[] },
): RewindFlow {
  if (current.kind !== 'loading_preview' || current.commandId !== response.commandId
    || current.chatId !== response.chatId || current.candidate.messageId !== response.targetMessageId) return current;
  return {
    kind: 'confirm', chatId: current.chatId, candidate: current.candidate,
    candidates: current.candidates, previewFingerprint: response.previewFingerprint,
    fileChanges: response.fileChanges,
  };
}

export function executingRewind(current: RewindFlow, commandId: string): RewindFlow {
  if (current.kind !== 'confirm') return current;
  return {
    kind: 'executing', chatId: current.chatId, commandId,
    candidate: current.candidate, fileChanges: current.fileChanges,
  };
}

export function completeRewind(current: RewindFlow, commandId: string): RewindFlow {
  return current.kind === 'executing' && current.commandId === commandId
    ? { kind: 'completed', chatId: current.chatId }
    : current;
}

export function failRewind(current: RewindFlow, commandId: string, code: string, detail: string): RewindFlow {
  if (!('commandId' in current) || current.commandId !== commandId || !('chatId' in current)) return current;
  if (current.kind === 'executing' && code === 'DELIVERY_UNKNOWN') {
    return { kind: 'delivery_unknown', chatId: current.chatId, detail };
  }
  const stage = current.kind === 'loading_candidates' ? 'candidates'
    : current.kind === 'loading_preview' ? 'preview' : 'execute';
  const candidates = 'candidates' in current ? current.candidates : [];
  return { kind: 'error', chatId: current.chatId, stage, detail, candidates };
}

