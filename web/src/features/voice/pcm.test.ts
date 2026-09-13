import { describe, expect, it } from 'vitest';
import { floatToPcm16le, joinDictation } from './pcm';

describe('voice pcm', () => {
  it('encodes 16 kHz silence as little-endian frames', () => {
    const pcm = floatToPcm16le(new Float32Array(4), 16_000);
    expect(pcm.length).toBe(8);
    expect([...pcm]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('decimates 48 kHz by averaging groups of three', () => {
    const input = new Float32Array([0.3, 0.3, 0.3, -0.6, -0.6, -0.6]);
    const pcm = floatToPcm16le(input, 48_000);
    expect(pcm.length).toBe(4);
    const view = new DataView(pcm.buffer);
    expect(view.getInt16(0, true)).toBe(Math.round(0.3 * 0x7fff));
    expect(view.getInt16(2, true)).toBe(Math.round(-0.6 * 0x7fff));
  });

  it('joins dictation without duplicating spaces', () => {
    expect(joinDictation('', 'hello')).toBe('hello');
    expect(joinDictation('hello', 'world')).toBe('hello world');
    expect(joinDictation('hello ', 'world')).toBe('hello world');
  });
});
