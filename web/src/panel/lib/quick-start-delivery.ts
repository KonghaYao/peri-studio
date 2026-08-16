import { createSignal } from 'solid-js';
import { createSingleSlotDelivery, type DeliveryPhase } from './delivery-state';

export type QuickStartPhase = Extract<DeliveryPhase, 'creating' | 'accepted' | 'uncertain' | 'failed'>;

export interface QuickStartSubmission {
  commandId: string;
  projectId: string;
  text: string;
  phase: QuickStartPhase;
  detail: string | null;
  retryable: boolean;
}

export interface QuickStartActivation {
  commandId: string;
  sessionId: string;
  chatId: string;
  text: string;
}

const [currentSubmission, setCurrentSubmission] = createSignal<QuickStartSubmission | null>(null);
const delivery = createSingleSlotDelivery(currentSubmission, setCurrentSubmission);

export const quickStartSubmission = currentSubmission;

export function startQuickStart(commandId: string, projectId: string, text: string): boolean {
  if (currentSubmission()) return false;
  setCurrentSubmission({ commandId, projectId, text, phase: 'creating', detail: null, retryable: true });
  return true;
}

export function acceptQuickStart(commandId: string): void {
  delivery.transition(commandId, (current) => ({ ...current, phase: 'accepted', detail: null }));
}

export function markQuickStartUncertain(commandId: string): void {
  delivery.transition(commandId, (current) => ({
    ...current,
    phase: 'uncertain',
    detail: 'Session creation is not confirmed. Reconfirming reuses the same request and will not create a duplicate session.',
    retryable: true,
  }));
}

export function failQuickStart(commandId: string, detail: string): void {
  delivery.transition(commandId, (current) => ({ ...current, phase: 'failed', detail, retryable: false }));
}

export function retryQuickStartDelivery(commandId: string): void {
  delivery.transition(commandId, (current) => ({ ...current, phase: 'creating', detail: null }));
}

export function completeQuickStart(commandId: string, status: unknown, sessionId: unknown, chatId: unknown): QuickStartActivation | null {
  const current = currentSubmission();
  if (!current || !canActivate(current, commandId, status, sessionId, chatId)) return null;
  setCurrentSubmission(null);
  return { commandId, sessionId: sessionId as string, chatId: chatId as string, text: current.text };
}

export function settleLateQuickStart(commandId: string, status: unknown, sessionId: unknown, chatId: unknown): boolean {
  const current = currentSubmission();
  if (!current || !canActivate(current, commandId, status, sessionId, chatId)) return false;
  setCurrentSubmission({
    ...current,
    phase: 'failed',
    detail: 'The session was created on the server, but the first message was not sent automatically. Open the session from the sidebar and resend the preserved text.',
    retryable: false,
  });
  return true;
}

export function dismissFailedQuickStart(): void {
  if (currentSubmission()?.phase === 'failed') setCurrentSubmission(null);
}

export function resetQuickStart(): void {
  setCurrentSubmission(null);
}

function canActivate(
  current: QuickStartSubmission,
  commandId: string,
  status: unknown,
  sessionId: unknown,
  chatId: unknown,
): boolean {
  return current.commandId === commandId
    && (status === 'committed' || status === 'duplicate')
    && typeof sessionId === 'string'
    && !!sessionId
    && typeof chatId === 'string'
    && !!chatId;
}
