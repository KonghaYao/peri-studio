import { describe, expect, it } from 'vitest';
import { encodeQrMatrix, qrMatrixToSvg } from './qr-encode';

describe('qr-encode', () => {
  it('encodes full URLs without truncation', () => {
    const url = 'https://peri.studio/docs';
    const matrix = encodeQrMatrix(url);
    expect(matrix.length).toBeGreaterThan(21);
    expect(matrix[0].length).toBe(matrix.length);
    expect(matrix.some((row) => row.some(Boolean))).toBe(true);
  });

  it('renders scalable SVG with currentColor fill', () => {
    const matrix = encodeQrMatrix('https://peri.studio');
    const svg = qrMatrixToSvg(matrix);
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="100%"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain('<path');
  });

  it('supports longer pairing payloads', () => {
    const pairingUrl = 'https://studio.example.com:8456/pair?code=7K3M9P2Q';
    const matrix = encodeQrMatrix(pairingUrl, 'M');
    expect(matrix.length).toBeGreaterThanOrEqual(25);
  });
});
