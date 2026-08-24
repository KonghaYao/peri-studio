export type PrincipalRole = 'full' | 'read-only' | null;
export const canMutate = (role: PrincipalRole): boolean => role === 'full';
export interface PrincipalIdentity {
  role: Exclude<PrincipalRole, null>;
  principalId: string;
}

export const parsePrincipal = (value: unknown): PrincipalIdentity | null => {
  if (!value || typeof value !== 'object') return null;
  const { role, principalId } = value as { role?: unknown; principalId?: unknown };
  if (role !== 'full' && role !== 'read-only') return null;
  if (typeof principalId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(principalId)) return null;
  return { role, principalId };
};
