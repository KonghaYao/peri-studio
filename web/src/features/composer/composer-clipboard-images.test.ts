import { describe, expect, it } from 'vitest';
import {
  isGenericClipboardImageName,
  normalizeClipboardImageFile,
  parseClipboardImageFiles,
  uniqueClipboardImageName,
} from './composer-clipboard-images';

const STAMP = new Date('2026-09-13T14:31:07Z');

function imageFile(name: string, type = 'image/png'): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type });
}

describe('composer-clipboard-images', () => {
  it('renames empty and generic screenshot names so create-only uploads do not collide', () => {
    expect(isGenericClipboardImageName('')).toBe(true);
    expect(isGenericClipboardImageName('image.png')).toBe(true);
    expect(isGenericClipboardImageName('diagram.png')).toBe(false);
    expect(uniqueClipboardImageName(imageFile('image.png'), 0, STAMP)).toBe('clipboard-20260913-143107.png');
    expect(normalizeClipboardImageFile(imageFile('image.png'), 1, STAMP).name).toBe('clipboard-20260913-143107-2.png');
    expect(normalizeClipboardImageFile(imageFile('shot.jpg', 'image/jpeg'), 0, STAMP).name).toBe('shot.jpg');
  });

  it('collects image items from clipboard data and ignores text', () => {
    const png = imageFile('image.png');
    const data = {
      items: [
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'image/png', getAsFile: () => png },
      ],
      files: [png],
    } as unknown as DataTransfer;
    const files = parseClipboardImageFiles(data, STAMP);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('clipboard-20260913-143107.png');
    expect(parseClipboardImageFiles({
      items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
      files: [],
    } as unknown as DataTransfer)).toEqual([]);
  });

  it('falls back to DataTransfer.files when items are empty', () => {
    const jpeg = imageFile('image.jpeg', 'image/jpeg');
    const files = parseClipboardImageFiles({
      items: [],
      files: [jpeg, new File(['plain'], 'notes.txt', { type: 'text/plain' })],
    } as unknown as DataTransfer, STAMP);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('clipboard-20260913-143107.jpg');
  });

  it('rejects SVG and other non-raster clipboard types', () => {
    const svg = new File(['<svg></svg>'], 'image.svg', { type: 'image/svg+xml' });
    expect(parseClipboardImageFiles({
      items: [{ kind: 'file', type: 'image/svg+xml', getAsFile: () => svg }],
      files: [svg],
    } as unknown as DataTransfer, STAMP)).toEqual([]);
  });
});
