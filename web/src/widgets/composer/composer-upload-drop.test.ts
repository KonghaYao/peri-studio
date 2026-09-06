import { describe, expect, it } from 'vitest';
import { dataTransferHasDirectory, parseFileDropTransfer } from './composer-upload-drop';

describe('composer-upload-drop', () => {
  it('rejects directory entries from DataTransferItem', () => {
    const dataTransfer = {
      files: [],
      items: [{
        webkitGetAsEntry: () => ({ isDirectory: true }),
      }],
    } as unknown as DataTransfer;
    expect(dataTransferHasDirectory(dataTransfer)).toBe(true);
    expect(parseFileDropTransfer(dataTransfer)).toEqual({ ok: false, reason: 'directory' });
  });

  it('accepts flat files from DataTransfer', () => {
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    const dataTransfer = {
      files: [file],
      items: [{ webkitGetAsEntry: () => ({ isDirectory: false }) }],
    } as unknown as DataTransfer;
    const parsed = parseFileDropTransfer(dataTransfer);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.files).toHaveLength(1);
  });
});
