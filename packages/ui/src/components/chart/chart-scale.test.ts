import { describe, expect, it } from 'vitest';
import { formatChartCompact } from './chart-format';
import { axisTicks, bandSlot, linearScale, niceMax } from './chart-scale';

describe('chart-scale', () => {
  it('rounds up to nice axis maxima', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(9500)).toBe(10_000);
    expect(niceMax(180_000)).toBe(200_000);
  });

  it('maps domain values into pixel ranges', () => {
    const scale = linearScale(0, 100, 200, 0);
    expect(scale(0)).toBe(200);
    expect(scale(100)).toBe(0);
    expect(scale(50)).toBe(100);
  });

  it('creates evenly spaced axis ticks', () => {
    expect(axisTicks(0, 100)).toEqual([0, 50, 100]);
    expect(axisTicks(0, 0)).toEqual([0]);
  });

  it('allocates band slots across the inner width', () => {
    const first = bandSlot(0, 3, 300);
    const last = bandSlot(2, 3, 300);
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(last.x + last.width).toBeLessThanOrEqual(300);
  });
});

describe('formatChartCompact', () => {
  it('uses SI compact notation for large values', () => {
    expect(formatChartCompact(200_000_000)).toMatch(/200M/i);
    expect(formatChartCompact(200_000_000)).not.toMatch(/200000k/i);
  });
});
