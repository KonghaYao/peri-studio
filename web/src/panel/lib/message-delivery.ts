import { createSignal } from 'solid-js';
import { createSingleSlotDelivery, type DeliveryPhase } from './delivery-state';
import { clearComposerDraft, resetComposerDrafts, restoreComposerDraft } from './composer-draft';

export type MessageDeliveryPhase = Extract<
  DeliveryPhase,
  'sending' | 'accepted' | 'committed' | 'uncertain' | 'delivery_unknown' | 'failed'
>;

export interface MessageSubmission {
  commandId: string;
  text: string;
  sessionId: string;
  chatId: string;
  phase: MessageDeliveryPhase;
  detail: string | null;
  retryable: boolean;
  /** Exact durable entry has arrived; terminal command outcome is still pending. */
  projected: boolean;
}

const [currentSubmission, setCurrentSubmission] = createSignal<MessageSubmission | null>(null);
const delivery = createSingleSlotDelivery(currentSubmission, setCurrentSubmission);

export const messageSubmission = currentSubmission;

export function startMessageDelivery(commandId: string, text: string, sessionId: string, chatId: string): boolean {
  if (currentSubmission()) return false;
  setCurrentSubmission({ commandId, text, sessionId, chatId, phase: 'sending', detail: null, retryable: true, projected: false });
  clearComposerDraft(sessionId);
  return true;
}

export function acceptMessageDelivery(commandId: string): void {
  delivery.transition(commandId, (current) => ({ ...current, phase: 'accepted', detail: null }));
}

export function markMessageDeliveryUncertain(commandId: string): void {
  delivery.transition(commandId, (current) => ({
    ...current,
    phase: 'uncertain',
    detail: 'The server has not confirmed the outcome. Reconfirming will not re-execute it.',
    retryable: true,
  }));
}

export function failMessageDelivery(commandId: string, detail: string): void {
  const current = currentSubmission();
  if (!current || current.commandId !== commandId) return;
  if (current.projected) {
    setCurrentSubmission(null);
    return;
  }
  setCurrentSubmission({ ...current, phase: 'failed', detail, retryable: false });
}

/** Server crossed the no-redelivery barrier but cannot prove the outcome. */
export function blockUnknownMessageDelivery(commandId: string, detail?: string): void {
  delivery.transition(commandId, (current) => ({
    ...current,
    phase: 'delivery_unknown',
    detail: detail || 'This message may have already executed. To avoid duplicates, resending and editing are disabled.',
    retryable: false,
  }));
}

export function retryMessageDelivery(commandId: string): void {
  delivery.transition(commandId, (current) => ({ ...current, phase: 'sending', detail: null }));
}

export function completeMessageDelivery(commandId: string, status: unknown): boolean {
  const current = currentSubmission();
  if (!current || current.commandId !== commandId || (status !== 'committed' && status !== 'duplicate')) return false;
  if (current.projected) {
    setCurrentSubmission(null);
    return true;
  }
  setCurrentSubmission({
    ...current,
    phase: 'committed',
    detail: 'Confirmed by the server, syncing to the conversation log.',
    retryable: false,
  });
  return true;
}

/** Only the exact durable Yjs identity may replace the local outbox item. */
export function reconcileMessageProjection(sourceCommandIds: ReadonlySet<string>): boolean {
  const current = currentSubmission();
  if (!current || !sourceCommandIds.has(current.commandId)) return false;
  if (current.phase === 'committed') setCurrentSubmission(null);
  else setCurrentSubmission({ ...current, projected: true });
  return true;
}

export function dismissFailedMessageDelivery(): void {
  const current = currentSubmission();
  if (!current || current.phase !== 'failed') return;
  restoreComposerDraft(current.sessionId, current.text);
  setCurrentSubmission(null);
}

export function resetMessageDelivery(): void {
  setCurrentSubmission(null);
  resetComposerDrafts();
}
