export type GitGraphActionKind =
  | 'checkout'
  | 'create-branch'
  | 'rename-branch'
  | 'reset'
  | 'revert';

export type GitResetMode = 'soft' | 'mixed' | 'hard';

export interface GitGraphActionParams {
  targetOid?: string;
  refName?: string;
  newRefName?: string;
  resetMode?: GitResetMode;
}

const GRAPH_ACTIONS = new Set<GitGraphActionKind>([
  'checkout',
  'create-branch',
  'rename-branch',
  'reset',
  'revert',
]);

const OID_RE = /^[0-9a-f]{40}$/i;
const REF_RE = /^[^\s\x00-\x1f\x7f]+$/;

export function isGitGraphAction(action: string): action is GitGraphActionKind {
  return GRAPH_ACTIONS.has(action as GitGraphActionKind);
}

export function isValidOid(value: string | undefined): value is string {
  return typeof value === 'string' && OID_RE.test(value.trim());
}

export function isValidRefName(value: string | undefined): value is string {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  if (!name || name.length > 255) return false;
  if (!REF_RE.test(name)) return false;
  if (name.includes('..') || name.includes('@{') || name.startsWith('-') || name.endsWith('/')) return false;
  return true;
}

export function validateGitGraphAction(action: GitGraphActionKind, params: GitGraphActionParams): boolean {
  switch (action) {
    case 'checkout':
      return (isValidRefName(params.refName) && !params.targetOid)
        || (isValidOid(params.targetOid) && !params.refName);
    case 'create-branch':
      return isValidRefName(params.refName) && isValidOid(params.targetOid);
    case 'rename-branch':
      return isValidRefName(params.refName) && isValidRefName(params.newRefName);
    case 'reset':
      return isValidOid(params.targetOid);
    case 'revert':
      return isValidOid(params.targetOid);
    default:
      return false;
  }
}
