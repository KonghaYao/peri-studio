import { describe, expect, it } from 'vitest';
import {
  composerWorkspaceUploadPath,
  joinWorkspaceUploadPath,
  MAX_UPLOAD_FILE_BYTES,
  pickLocalUploadFile,
  sanitizeUploadBasename,
} from './upload-path';

describe('upload-path', () => {
  it('sanitizes basename and rejects path segments in File.name', () => {
    expect(sanitizeUploadBasename('notes.txt')).toBe('notes.txt');
    expect(sanitizeUploadBasename('../evil.txt')).toBe('evil.txt');
    expect(sanitizeUploadBasename('')).toBeNull();
    expect(pickLocalUploadFile(new File(['x'], 'src/hack.txt'), 'id-1', '').ok).toBe(false);
  });

  it('joins explorer directory paths without trusting file.path', () => {
    expect(joinWorkspaceUploadPath('src/utils', 'a.ts')).toBe('src/utils/a.ts');
    expect(composerWorkspaceUploadPath('a.ts')).toBe('a.ts');
    expect(joinWorkspaceUploadPath('', 'readme.md')).toBe('readme.md');
  });

  it('rejects files over 8 MiB before transport', () => {
    const big = new File([new Uint8Array(MAX_UPLOAD_FILE_BYTES + 1)], 'big.bin');
    const result = pickLocalUploadFile(big, 'id-2', 'docs');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too_large');
  });
});
