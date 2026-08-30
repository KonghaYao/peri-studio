import { createSignal } from 'solid-js';
import type { PendingElicitation } from '@/entities/chat/control-view';

export type ElicitationDeliveryPhase = 'pending' | 'confirmed' | 'failed' | 'uncertain' | 'delivery_unknown';

export interface ElicitationDeliveryState {
  commandId: string | null;
  phase: ElicitationDeliveryPhase;
  dismissed: boolean;
}

const [responses, setResponses] = createSignal<Record<string, ElicitationDeliveryState>>({});

export const elicitationResponses = responses;

/** 同一追问只允许一个不可重放的回答命令。 */
export function startElicitationResponse(elicitationId: string, commandId: string): boolean {
  if (responses()[elicitationId]) return false;
  setResponses((current) => ({
    ...current,
    [elicitationId]: { commandId, phase: 'pending', dismissed: false },
  }));
  return true;
}

export function completeElicitationResponse(commandId: string): void {
  updateByCommand(commandId, (current) => ({ ...current, phase: 'confirmed' }));
}

export function failElicitationResponse(commandId: string): void {
  updateByCommand(commandId, (current) => ({ ...current, phase: 'failed' }));
}

/** 仅 transport 明确未接受 frame 时撤销尚未发送的本地占位。 */
export function rollbackElicitationResponse(commandId: string): void {
  updateByCommand(commandId, null);
}

export function markElicitationResponseUncertain(
  commandId: string,
  phase: Extract<ElicitationDeliveryPhase, 'uncertain' | 'delivery_unknown'>,
): void {
  updateByCommand(commandId, (current) => ({ ...current, phase }));
}

/** 只隐藏未知结果，不释放原命令身份，也不允许再次回答。 */
export function dismissUncertainElicitation(elicitationId: string): boolean {
  const current = responses()[elicitationId];
  if (!current || current.phase === 'pending') return false;
  setResponses((items) => ({ ...items, [elicitationId]: { ...current, dismissed: true } }));
  return true;
}

export function visibleElicitations(items: readonly PendingElicitation[]): PendingElicitation[] {
  const current = responses();
  return items.filter((item) => !current[item.elicitationId]?.dismissed);
}

/** 权威投影移除追问后，释放对应的浏览器交付证据。 */
export function retainProjectedElicitations(items: readonly PendingElicitation[]): void {
  const visibleIds = new Set(items.map((item) => item.elicitationId));
  setResponses((current) => {
    const next = Object.fromEntries(
      Object.entries(current).filter(([elicitationId]) => visibleIds.has(elicitationId)),
    );
    for (const item of items) {
      if (item.status === 'responding' && !next[item.elicitationId]) {
        next[item.elicitationId] = { commandId: null, phase: 'delivery_unknown', dismissed: false };
      }
    }
    return next;
  });
}

export function resetElicitationResponses(): void {
  setResponses({});
}

function updateByCommand(
  commandId: string,
  update: ((current: ElicitationDeliveryState) => ElicitationDeliveryState) | null,
): void {
  setResponses((current) => {
    const match = Object.entries(current).find(([, state]) => state.commandId === commandId);
    if (!match) return current;
    const [elicitationId, state] = match;
    if (update) return { ...current, [elicitationId]: update(state) };
    const next = { ...current };
    delete next[elicitationId];
    return next;
  });
}
