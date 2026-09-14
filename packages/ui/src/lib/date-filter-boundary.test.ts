import { describe, expect, it } from 'vitest';
import { formatDay, toIso, toLocalDate } from './date-filter-boundary';

describe('date-filter-boundary', () => {
  const sample = new Date(2026, 7, 15);

  it('toLocalDate parses valid ISO and rejects invalid input', () => {
    const iso = toIso(sample, 'start');
    expect(toLocalDate(iso)?.getDate()).toBe(15);
    expect(toLocalDate(undefined)).toBeUndefined();
    expect(toLocalDate('not-a-date')).toBeUndefined();
  });

  it('toIso uses local midnight for start boundary', () => {
    expect(toIso(sample, 'start')).toBe(
      new Date(sample.getFullYear(), sample.getMonth(), sample.getDate()).toISOString(),
    );
  });

  it('toIso uses local end-of-day for end boundary', () => {
    expect(toIso(sample, 'end')).toBe(
      new Date(
        sample.getFullYear(),
        sample.getMonth(),
        sample.getDate(),
        23,
        59,
        59,
        999,
      ).toISOString(),
    );
  });

  it('formatDay renders zero-padded local calendar date', () => {
    expect(formatDay(sample)).toBe('2026-08-15');
    expect(formatDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
