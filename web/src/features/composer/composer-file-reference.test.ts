import { describe, expect, it } from 'vitest';
import {
  applyFileReferenceWithBudget,
  draftContainsReferenceToken,
  formatFileReferenceToken,
  insertFileReferenceAtCaret,
} from './composer-file-reference';

describe('composer-file-reference', () => {
  it('formats workspace-relative @ tokens', () => {
    expect(formatFileReferenceToken('src/a.ts')).toBe('@src/a.ts');
    expect(formatFileReferenceToken('/src/a.ts')).toBe('@src/a.ts');
  });

  it('inserts at caret with UX newline after trailing space', () => {
    const draft = 'hello ';
    const end = draft.length;
    const next = insertFileReferenceAtCaret(draft, end, end, 'src/a.ts');
    expect(next.text).toBe('hello \n@src/a.ts');
    expect(next.caret).toBe(next.text.length);
  });

  it('respects prompt byte budget', () => {
    const draft = 'x'.repeat(100);
    const result = applyFileReferenceWithBudget(draft, draft.length, draft.length, 'src/a.ts', 109);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('budget_exceeded');
  });

  it('detects duplicate reference tokens', () => {
    const draft = 'hello @src/a.ts';
    expect(draftContainsReferenceToken(draft, 'src/a.ts')).toBe(true);
    expect(draftContainsReferenceToken(draft, 'src/b.ts')).toBe(false);
  });
});
