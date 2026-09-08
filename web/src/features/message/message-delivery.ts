import { createSignal } from 'solid-js';
import type { DeliveryPhase } from '../../panel/lib/delivery-state';
import { clearComposerDraft, composerDraft, resetComposerDrafts, restoreComposerDraft, type ComposerDraftOwner } from '@/features/composer/composer-draft';

export type MessageDeliveryPhase = Extract<
  DeliveryPhase,
  'sending' | 'accepted' | 'committed' | 'uncertain' | 'delivery_unknown' | 'failed'
>;

export interface MessageSubmission {
  commandId: string;
  text: string;
  sessionId: string;
  chatId: string;
  draftOwner: ComposerDraftOwner;
  phase: MessageDeliveryPhase;
  detail: string | null;
  retryable: boolean;
  /** Exact durable entry has arrived; terminal command outcome is still pending. */
  projected: boolean;
}

const [submissionsBySession, setSubmissionsBySession] = createSignal<Record<string, MessageSubmission>>({});
const [acknowledgedUnknown, setAcknowledgedUnknown] = createSignal<MessageSubmission[]>([]);
const [projectedCommands, setProjectedCommands] = createSignal<string[]>([]);
const ACKNOWLEDGED_UNKNOWN_LIMIT = 20;
const PROJECTED_COMMAND_LIMIT = 64;

export const messageSubmissions = () => Object.values(submissionsBySession());
/** 按持久会话读取唯一未裁决提交；不再把其他会话变成全局输入门禁。 */
export const messageSubmission = (sessionId?: string | null): MessageSubmission | null => {
  if (sessionId) return submissionsBySession()[sessionId] ?? null;
  return messageSubmissions()[0] ?? null;
};
export const messageSubmissionForChat = (chatId: string | null): MessageSubmission | null =>
  chatId ? messageSubmissions().find((item) => item.chatId === chatId) ?? null : null;
export const messageSubmissionByCommand = (commandId: string): MessageSubmission | null =>
  messageSubmissions().find((item) => item.commandId === commandId) ?? null;
/** 用户已确认继续工作、但仍须保留在会话中的不可重发证据。 */
export const acknowledgedMessageDeliveries = acknowledgedUnknown;
export const canAcknowledgeUnknownMessageDelivery = (commandId: string): boolean =>
  messageSubmissionByCommand(commandId)?.projected === true
  || acknowledgedUnknown().length < ACKNOWLEDGED_UNKNOWN_LIMIT;

function replace(current: MessageSubmission, next: MessageSubmission | null): void {
  setSubmissionsBySession((items) => {
    if (items[current.sessionId]?.commandId !== current.commandId) return items;
    const updated = { ...items };
    if (next) updated[current.sessionId] = next;
    else delete updated[current.sessionId];
    return updated;
  });
}

function transition(commandId: string, update: (current: MessageSubmission) => MessageSubmission): void {
  const current = messageSubmissionByCommand(commandId);
  if (current) replace(current, update(current));
}

function rememberProjectedCommand(commandId: string): void {
  setProjectedCommands((items) => {
    if (items.includes(commandId)) return items;
    const next = [...items, commandId];
    return next.length > PROJECTED_COMMAND_LIMIT ? next.slice(-PROJECTED_COMMAND_LIMIT) : next;
  });
}

export function settleProjectedMessageDelivery(commandId: string | undefined): void {
  if (!commandId) return;
  setProjectedCommands((items) => items.includes(commandId)
    ? items.filter((item) => item !== commandId)
    : items);
}

export function startMessageDelivery(
  commandId: string,
  text: string,
  sessionId: string,
  chatId: string,
  owner: ComposerDraftOwner = { principalId: 'test-principal', projectId: 'test-project', sessionId },
): boolean {
  if (messageSubmission(sessionId) || messageSubmissionByCommand(commandId)) return false;
  setSubmissionsBySession((items) => ({
    ...items,
    [sessionId]: { commandId, text, sessionId, chatId, draftOwner: owner, phase: 'sending', detail: null, retryable: true, projected: false },
  }));
  clearComposerDraft(owner);
  return true;
}

export function acceptMessageDelivery(commandId: string): void {
  transition(commandId, (current) => ({ ...current, phase: 'accepted', detail: null }));
}

export function markMessageDeliveryUncertain(commandId: string): void {
  const current = messageSubmissionByCommand(commandId);
  if (current) restoreComposerDraft(current.draftOwner, current.text);
  transition(commandId, (current) => ({
    ...current,
    phase: 'uncertain',
    detail: 'The server has not confirmed the outcome. Reconfirming will not re-execute it.',
    retryable: true,
  }));
}

export function failMessageDelivery(commandId: string, detail: string): void {
  const current = messageSubmissionByCommand(commandId);
  if (!current) return;
  if (current.projected) {
    clearMatchingRestoredDraft(current);
    replace(current, null);
  } else {
    restoreComposerDraft(current.draftOwner, current.text);
    replace(current, { ...current, phase: 'failed', detail, retryable: false });
  }
}

/** Server crossed the no-redelivery barrier but cannot prove the outcome. */
export function blockUnknownMessageDelivery(commandId: string, detail?: string): void {
  const current = messageSubmissionByCommand(commandId);
  // 精确 source_command_id 已进入权威 Chat Doc，消息投递本身已经被证明。
  // 后到的 ACP 终态不确定不能再把 Composer 锁回去。
  if (current?.projected) {
    clearMatchingRestoredDraft(current);
    replace(current, null);
    return;
  }
  if (current) clearMatchingRestoredDraft(current);
  transition(commandId, (current) => ({
    ...current,
    phase: 'delivery_unknown',
    detail: detail || 'This message may have already executed. To avoid duplicates, resending and editing are disabled.',
    retryable: false,
  }));
}

/** Prompt 的 delivery-unknown 由消息投递面接管，避免再生成一张全局重复错误卡。 */
export function ownsMessageDeliveryError(commandId: string | undefined, code: string | undefined): boolean {
  return code === 'DELIVERY_UNKNOWN' && Boolean(commandId && (
    messageSubmissionByCommand(commandId) || projectedCommands().includes(commandId)
  ));
}

/** 只解除所属会话的单飞门禁；不可重放证据保留到精确投影到达。 */
export function acknowledgeUnknownMessageDelivery(commandId: string): boolean {
  const current = messageSubmissionByCommand(commandId);
  if (!current || current.phase !== 'delivery_unknown') return false;
  if (!current.projected) {
    if (!canAcknowledgeUnknownMessageDelivery(commandId)) return false;
    setAcknowledgedUnknown((items) => items.some((item) => item.commandId === commandId)
      ? items
      : [...items, current]);
  }
  replace(current, null);
  return true;
}

export function retryMessageDelivery(commandId: string): void {
  transition(commandId, (current) => ({ ...current, phase: 'sending', detail: null }));
}

export function completeMessageDelivery(commandId: string, status: unknown): boolean {
  if (status !== 'committed' && status !== 'duplicate') return false;
  settleProjectedMessageDelivery(commandId);
  const current = messageSubmissionByCommand(commandId);
  if (!current) return false;
  clearMatchingRestoredDraft(current);
  if (current.projected) {
    replace(current, null);
  }
  else replace(current, {
    ...current,
    phase: 'committed',
    detail: 'Confirmed by the server, syncing to the conversation log.',
    retryable: false,
  });
  return true;
}

function clearMatchingRestoredDraft(submission: MessageSubmission): void {
  if (composerDraft(submission.draftOwner) === submission.text) {
    clearComposerDraft(submission.draftOwner);
  }
}

/** Only the exact durable Yjs identity may replace local outbox items. */
export function reconcileMessageProjection(sourceCommandIds: ReadonlySet<string>): boolean {
  const archived = acknowledgedUnknown();
  const retained = archived.filter((item) => !sourceCommandIds.has(item.commandId));
  let changed = retained.length !== archived.length;
  if (changed) setAcknowledgedUnknown(retained);
  for (const current of messageSubmissions()) {
    if (!sourceCommandIds.has(current.commandId)) continue;
    changed = true;
    if (current.phase === 'committed' || current.phase === 'uncertain' || current.phase === 'delivery_unknown') {
      // 仅 timeout 后尚未收到终态的命令需要保留乱序 ownership；
      // 已裁决命令不得污染这个有界集合。
      if (current.phase === 'uncertain') rememberProjectedCommand(current.commandId);
      clearMatchingRestoredDraft(current);
      replace(current, null);
    }
    else replace(current, { ...current, projected: true });
  }
  return changed;
}

export function dismissFailedMessageDelivery(commandId: string): void {
  const current = messageSubmissionByCommand(commandId);
  if (!current || current.phase !== 'failed') return;
  restoreComposerDraft(current.draftOwner, current.text);
  replace(current, null);
}

export function resetMessageDelivery(preserveDrafts = false): void {
  setSubmissionsBySession({});
  setAcknowledgedUnknown([]);
  setProjectedCommands([]);
  if (!preserveDrafts) resetComposerDrafts();
}
