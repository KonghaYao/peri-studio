import { createSignal } from 'solid-js';
import { createKeyedDelivery, type DeliveryPhase } from './delivery-state';

export type RuntimeControlKind = 'cancel' | 'close';
export type RuntimeControlPhase = Extract<DeliveryPhase, 'sending' | 'accepted' | 'uncertain' | 'confirmed' | 'failed'>;

export interface RuntimeControlSubmission {
  commandId: string;
  chatId: string;
  kind: RuntimeControlKind;
  phase: RuntimeControlPhase;
  detail: string | null;
  retryable: boolean;
}

const [controls, setControls] = createSignal<Record<string, RuntimeControlSubmission>>({});
const delivery = createKeyedDelivery(
  () => new Map(Object.entries(controls())),
  (entries) => setControls(Object.fromEntries(entries)),
  (entry) => entry.chatId,
);

export const runtimeControlFor = (chatId: string | null): RuntimeControlSubmission | null =>
  chatId ? controls()[chatId] || null : null;

export const runtimeControlBusy = (chatId: string | null, kind?: RuntimeControlKind): boolean => {
  const control = runtimeControlFor(chatId);
  return !!control && (!kind || control.kind === kind) && control.phase !== 'failed';
};

export function startRuntimeControl(commandId: string, chatId: string, kind: RuntimeControlKind): boolean {
  const existing = controls()[chatId];
  if (existing && existing.phase !== 'failed') return false;
  setControls((current) => ({
    ...current,
    [chatId]: { commandId, chatId, kind, phase: 'sending', detail: null, retryable: true },
  }));
  return true;
}

export function acceptRuntimeControl(commandId: string): void {
  delivery.transition(commandId, (current) => ({ ...current, phase: 'accepted', detail: null }));
}

export function markRuntimeControlUncertain(commandId: string): void {
  delivery.transition(commandId, (current) => ({
    ...current,
    phase: 'uncertain',
    detail: current.kind === 'cancel'
      ? 'The stop request may still be in progress. Reconfirm with the original request instead of submitting new stop operations.'
      : 'The instance may have shut down. The session is still saved; reconfirm with the original request.',
    retryable: true,
  }));
}

export function failRuntimeControl(commandId: string, detail: string): void {
  delivery.transition(commandId, (current) => ({ ...current, phase: 'failed', detail, retryable: false }));
}

export function retryRuntimeControl(commandId: string): void {
  delivery.transition(commandId, (current) => ({ ...current, phase: 'sending', detail: null }));
}

export function confirmRuntimeControl(commandId: string, status: unknown): boolean {
  if (status !== 'committed' && status !== 'duplicate') return false;
  return delivery.transition(commandId, (current) => ({ ...current, phase: 'confirmed', detail: null, retryable: false }));
}

export function reconcileRuntimeControl(chatId: string, turnActive: boolean, terminal: boolean): void {
  const current = controls()[chatId];
  if (!current) return;
  if ((current.kind === 'cancel' && (!turnActive || terminal)) || (current.kind === 'close' && terminal)) {
    delivery.remove(chatId);
  }
}

export function resetRuntimeControls(): void {
  setControls({});
}
