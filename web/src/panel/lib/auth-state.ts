import { createSignal } from 'solid-js';
import { canMutate, type PrincipalRole } from './auth-role';

export interface AuthInvalidation {
  id: number;
  reason: string;
}

const [principal, setPrincipal] = createSignal<PrincipalRole>(null);
const [principalIdentifier, setPrincipalIdentifier] = createSignal<string | null>(null);
const [invalidation, setInvalidation] = createSignal<AuthInvalidation | null>(null);
let invalidationSequence = 0;

export const principalRole = principal;
export const principalId = principalIdentifier;
export const setPrincipalRole = (role: PrincipalRole): void => {
  setPrincipal(role);
  setPrincipalIdentifier(role ? `test-${role}` : null);
};
export const readOnly = (): boolean => !canMutate(principal());
export const authInvalidation = invalidation;

export function installPrincipalRole(role: PrincipalRole, id?: string): void {
  setPrincipal(role);
  setPrincipalIdentifier(role ? id ?? `test-${role}` : null);
}

export function publishAuthInvalidation(reason: string): void {
  setPrincipal(null);
  setPrincipalIdentifier(null);
  setInvalidation({ id: ++invalidationSequence, reason });
}

export function clearAuthInvalidation(): void {
  setInvalidation(null);
}
