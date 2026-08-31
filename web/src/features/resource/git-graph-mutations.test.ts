import { describe, expect, it } from 'vitest';
import { validateGitGraphAction } from './git-graph-mutations';

const OID = 'a'.repeat(40);

describe('validateGitGraphAction', () => {
  it('accepts checkout by oid or branch name', () => {
    expect(validateGitGraphAction('checkout', { targetOid: OID })).toBe(true);
    expect(validateGitGraphAction('checkout', { refName: 'main' })).toBe(true);
    expect(validateGitGraphAction('checkout', { targetOid: OID, refName: 'main' })).toBe(false);
  });

  it('accepts create, rename, reset, and revert payloads', () => {
    expect(validateGitGraphAction('create-branch', { refName: 'feature/x', targetOid: OID })).toBe(true);
    expect(validateGitGraphAction('rename-branch', { refName: 'old', newRefName: 'new' })).toBe(true);
    expect(validateGitGraphAction('reset', { targetOid: OID, resetMode: 'hard' })).toBe(true);
    expect(validateGitGraphAction('revert', { targetOid: OID })).toBe(true);
  });
});
