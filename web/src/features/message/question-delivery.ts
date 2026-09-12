import { createSignal } from 'solid-js';
import type { PendingQuestion } from '@/entities/chat/control-view';

export type QuestionDeliveryPhase = 'pending' | 'confirmed' | 'failed' | 'uncertain' | 'delivery_unknown';

export interface QuestionDeliveryState {
  commandId: string | null;
  phase: QuestionDeliveryPhase;
  dismissed: boolean;
}

const [responses, setResponses] = createSignal<Record<string, QuestionDeliveryState>>({});

export const questionResponses = responses;

/** 同一 AskUserQuestion 只允许一个不可重放的回答命令。 */
export function startQuestionResponse(questionId: string, commandId: string): boolean {
  if (responses()[questionId]) return false;
  setResponses((current) => ({
    ...current,
    [questionId]: { commandId, phase: 'pending', dismissed: false },
  }));
  return true;
}

export function completeQuestionResponse(commandId: string): void {
  updateByCommand(commandId, (current) => ({ ...current, phase: 'confirmed' }));
}

export function failQuestionResponse(commandId: string): void {
  updateByCommand(commandId, (current) => ({ ...current, phase: 'failed' }));
}

export function rollbackQuestionResponse(commandId: string): void {
  updateByCommand(commandId, null);
}

export function markQuestionResponseUncertain(
  commandId: string,
  phase: Extract<QuestionDeliveryPhase, 'uncertain' | 'delivery_unknown'>,
): void {
  updateByCommand(commandId, (current) => ({ ...current, phase }));
}

export function dismissUncertainQuestion(questionId: string): boolean {
  const current = responses()[questionId];
  if (!current || current.phase === 'pending') return false;
  setResponses((items) => ({ ...items, [questionId]: { ...current, dismissed: true } }));
  return true;
}

export function visibleQuestions(items: readonly PendingQuestion[]): PendingQuestion[] {
  const current = responses();
  return items.filter((item) => !current[item.questionId]?.dismissed);
}

function isTerminalQuestionDelivery(phase: QuestionDeliveryPhase): boolean {
  return phase === 'confirmed' || phase === 'failed' || phase === 'uncertain' || phase === 'delivery_unknown';
}

export function retainProjectedQuestions(items: readonly PendingQuestion[]): void {
  const visibleIds = new Set(items.map((item) => item.questionId));
  setResponses((current) => {
    const next: Record<string, QuestionDeliveryState> = {};
    for (const [questionId, state] of Object.entries(current)) {
      if (visibleIds.has(questionId)) {
        next[questionId] = state;
        continue;
      }
      if (state.phase === 'pending') {
        // Server resolved/expired the question off projection; release the spinner.
        continue;
      }
      if (!state.dismissed && isTerminalQuestionDelivery(state.phase)) {
        next[questionId] = state;
      }
    }
    for (const item of items) {
      if (item.status === 'responding' && !next[item.questionId]) {
        next[item.questionId] = { commandId: null, phase: 'delivery_unknown', dismissed: false };
      }
    }
    return next;
  });
}

export function resetQuestionResponses(): void {
  setResponses({});
}

function updateByCommand(
  commandId: string,
  update: ((current: QuestionDeliveryState) => QuestionDeliveryState) | null,
): void {
  setResponses((current) => {
    const match = Object.entries(current).find(([, state]) => state.commandId === commandId);
    if (!match) return current;
    const [questionId, state] = match;
    if (update) return { ...current, [questionId]: update(state) };
    const next = { ...current };
    delete next[questionId];
    return next;
  });
}
