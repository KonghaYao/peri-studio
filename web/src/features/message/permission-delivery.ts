import { createSignal } from 'solid-js';
import { createKeyedDelivery, type DeliveryPhase } from '../../panel/lib/delivery-state';

export type PermissionDecision = 'allow' | 'deny';
export type PermissionDecisionPhase = Extract<DeliveryPhase, 'pending' | 'uncertain'>;

export interface PermissionDecisionState {
  commandId: string;
  permissionId: string;
  decision: PermissionDecision;
  phase: PermissionDecisionPhase;
  retryable: boolean;
}

const [decisions, setDecisions] = createSignal<Map<string, PermissionDecisionState>>(new Map());
const delivery = createKeyedDelivery(
  decisions,
  (entries) => setDecisions(new Map(entries)),
  (entry) => entry.permissionId,
);

export const permissionDecisions = decisions;

export function startPermissionDecision(commandId: string, permissionId: string, decision: PermissionDecision): boolean {
  if (!permissionId || decisions().has(permissionId)) return false;
  setDecisions((current) => new Map(current).set(permissionId, { commandId, permissionId, decision, phase: 'pending', retryable: false }));
  return true;
}

export function markPermissionDecisionUncertain(commandId: string, retryable = false): void {
  delivery.transition(commandId, (current) => ({ ...current, phase: 'uncertain', retryable }));
}

export function retryPermissionDecision(commandId: string): void {
  delivery.transition(commandId, (current) => ({ ...current, phase: 'pending', retryable: false }));
}

export function failPermissionDecision(commandId: string): void {
  const entry = delivery.byCommand(commandId);
  if (entry) delivery.remove(entry.permissionId);
}

export function retainProjectedPermissions(permissionIds: ReadonlySet<string>): void {
  setDecisions((current) => {
    const retained = new Map([...current].filter(([permissionId]) => permissionIds.has(permissionId)));
    return retained.size === current.size ? current : retained;
  });
}

export function resetPermissionDecisions(): void {
  setDecisions(new Map());
}
