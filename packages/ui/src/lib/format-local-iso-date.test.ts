import { describe, expect, it } from 'vitest';
import { formatLocalIsoDate } from './format-local-iso-date';

describe('formatLocalIsoDate', () => {
  const utcDate = new Date(Date.UTC(2024, 5, 15, 14, 30, 45, 123));

  it('formats UTC day accuracy', () => {
    expect(formatLocalIsoDate(utcDate, true, 'day')).toBe('2024-06-15');
  });

  it('formats UTC hour accuracy', () => {
    expect(formatLocalIsoDate(utcDate, true, 'hour')).toBe('2024-06-15 14');
  });

  it('formats UTC minute accuracy', () => {
    expect(formatLocalIsoDate(utcDate, true, 'minute')).toBe('2024-06-15 14:30');
  });

  it('formats UTC second accuracy', () => {
    expect(formatLocalIsoDate(utcDate, true, 'second')).toBe('2024-06-15 14:30:45');
  });

  it('formats UTC millisecond accuracy', () => {
    expect(formatLocalIsoDate(utcDate, true, 'millisecond')).toBe('2024-06-15 14:30:45.123');
  });

  it('uses local getters when useUTC is false', () => {
    const localDate = new Date(2024, 5, 15, 14, 30, 45, 123);
    const expected = `${localDate.getFullYear()}-06-15 14:30:45.123`;
    expect(formatLocalIsoDate(localDate, false, 'millisecond')).toBe(expected);
  });
});
