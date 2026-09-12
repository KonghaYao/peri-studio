import { describe, expect, it } from 'vitest';
import {
  composerShellExpanded,
  composerSoftWrapsAtWidth,
} from '../src/components/composer/composer-shell-utils';

describe('composerSoftWrapsAtWidth', () => {
  it('stays compact for a single line that still fits the pill field', () => {
    expect(composerSoftWrapsAtWidth({
      draft: '你好',
      nowrapWidth: 80,
      compactWidth: 120,
      currentlyWrapped: false,
    })).toBe(false);
  });

  it('expands when nowrap text overflows the compact field, and stays expanded at the same width', () => {
    const overflowing = {
      draft: '请打开 sidebar 里那份很长的归档文件并继续',
      nowrapWidth: 360,
      compactWidth: 200,
    };
    expect(composerSoftWrapsAtWidth({ ...overflowing, currentlyWrapped: false })).toBe(true);
    expect(composerSoftWrapsAtWidth({ ...overflowing, currentlyWrapped: true })).toBe(true);
  });

  it('does not flap on a 1px metric jitter after IME commit', () => {
    expect(composerSoftWrapsAtWidth({
      draft: '你好',
      nowrapWidth: 201,
      compactWidth: 200,
      currentlyWrapped: false,
    })).toBe(false);
    expect(composerSoftWrapsAtWidth({
      draft: '你好',
      nowrapWidth: 201,
      compactWidth: 200,
      currentlyWrapped: true,
    })).toBe(false);
  });

  it('ignores soft-wrap once the draft already has a hard newline', () => {
    expect(composerSoftWrapsAtWidth({
      draft: 'hello\nworld',
      nowrapWidth: 400,
      compactWidth: 120,
      currentlyWrapped: false,
    })).toBe(false);
    expect(composerShellExpanded({
      draft: 'hello\nworld',
      attachmentCount: 0,
      wrapped: false,
    })).toBe(true);
  });
});
