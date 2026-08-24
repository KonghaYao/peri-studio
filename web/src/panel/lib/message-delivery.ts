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
const [acknowledgedUnknown, setAcknowledgedUnknown] = createSignal<MessageSubmission[]>([]);
const delivery = createSingleSlotDelivery(currentSubmission, setCurrentSubmission);
const ACKNOWLEDGED_UNKNOWN_LIMIT = 20;

export const messageSubmission = currentSubmission;
/** 用户已确认继续工作、但仍须保留在会话中的不可重发证据。 */
export const acknowledgedMessageDeliveries = acknowledgedUnknown;
export const canAcknowledgeUnknownMessageDelivery = () => currentSubmission()?.projected === true
  || acknowledgedUnknown().length < ACKNOWLEDGED_UNKNOWN_LIMIT;

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

/**
 * 只解除浏览器的全局单飞门禁，不恢复草稿、不重发原 command。
 * 原始证据移入只读历史，直到精确 server 投影到达或身份边界重置。
 */
export function acknowledgeUnknownMessageDelivery(commandId: string): boolean {
  const current = currentSubmission();
  if (!current || current.commandId !== commandId || current.phase !== 'delivery_unknown') return false;
  if (!current.projected) {
    if (!canAcknowledgeUnknownMessageDelivery()) return false;
    setAcknowledgedUnknown((items) => items.some((item) => item.commandId === commandId)
      ? items
      : [...items, current]);
  }
  setCurrentSubmission(null);
  return true;
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
  const archived = acknowledgedUnknown();
  const retained = archived.filter((item) => !sourceCommandIds.has(item.commandId));
  const archivedReconciled = retained.length !== archived.length;
  if (archivedReconciled) setAcknowledgedUnknown(retained);
  const current = currentSubmission();
  if (!current || !sourceCommandIds.has(current.commandId)) return archivedReconciled;
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
  setAcknowledgedUnknown([]);
  resetComposerDrafts();
}
