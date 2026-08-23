import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './resource-diff';

describe('unified Git diff projection', () => {
  it('aligns context and replacement runs into side-by-side editor rows', () => {
    const parsed = parseUnifiedDiff([
      'diff --git a/src/main.ts b/src/main.ts',
      '--- a/src/main.ts',
      '+++ b/src/main.ts',
      '@@ -1,3 +1,4 @@',
      ' keep',
      '-before',
      '+after',
      '+extra',
      ' tail',
      '',
    ].join('\n'));

    expect(parsed.oldLabel).toBe('a/src/main.ts');
    expect(parsed.newLabel).toBe('b/src/main.ts');
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].rows).toEqual([
      { leftNumber: 1, rightNumber: 1, leftText: 'keep', rightText: 'keep', kind: 'context' },
      { leftNumber: 2, rightNumber: 2, leftText: 'before', rightText: 'after', kind: 'change' },
      { rightNumber: 3, rightText: 'extra', kind: 'change' },
      { leftNumber: 3, rightNumber: 4, leftText: 'tail', rightText: 'tail', kind: 'context' },
    ]);
  });

  it('recognizes binary diffs without inventing text rows', () => {
    const parsed = parseUnifiedDiff('diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n');
    expect(parsed.binary).toBe(true);
    expect(parsed.hunks).toEqual([]);
  });

  it('does not mistake hunk content beginning with header markers for file labels', () => {
    const parsed = parseUnifiedDiff([
      '--- a/options.txt',
      '+++ b/options.txt',
      '@@ -1 +1 @@',
      '--- old option',
      '+++ new option',
      '',
    ].join('\n'));

    expect(parsed.oldLabel).toBe('a/options.txt');
    expect(parsed.newLabel).toBe('b/options.txt');
    expect(parsed.hunks[0].rows).toEqual([{
      leftNumber: 1,
      rightNumber: 1,
      leftText: '-- old option',
      rightText: '++ new option',
      kind: 'change',
    }]);
  });

  it('caps projected rows while preserving an explicit truncation signal', () => {
    const parsed = parseUnifiedDiff([
      '--- a/large.txt',
      '+++ b/large.txt',
      '@@ -1,4 +1,4 @@',
      ' one',
      ' two',
      ' three',
      ' four',
    ].join('\n'), 2);

    expect(parsed.hunks[0].rows).toHaveLength(2);
    expect(parsed.truncated).toBe(true);
  });
});
