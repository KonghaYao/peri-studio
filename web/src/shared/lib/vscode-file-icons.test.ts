import { describe, expect, it } from 'vitest';
import { vscodeFileIconKind, vscodeFolderIconKind } from '@peri/ui';

describe('VS Code file icon mapping (re-export)', () => {
  it('maps typescript paths', () => {
    expect(vscodeFileIconKind('src/main.ts')).toBe('typescript');
  });

  it('maps folder names', () => {
    expect(vscodeFolderIconKind('src', false)).toBe('folder-src');
  });
});
