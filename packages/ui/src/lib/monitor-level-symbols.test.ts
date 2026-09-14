import { describe, expect, it } from 'vitest';
import {
  formatCountLabelAsLevel,
  formatLevelCountNumber,
  levelCountsFromRecord,
  monitorLevelSymbol,
  MONITOR_LEVEL_SYMBOLS,
} from './monitor-level-symbols';

describe('monitor-level-symbols', () => {
  it('maps count labels to observation levels', () => {
    expect(formatCountLabelAsLevel('errorCount')).toBe('ERROR');
    expect(formatCountLabelAsLevel('warningCount')).toBe('WARNING');
    expect(formatCountLabelAsLevel('debugCount')).toBe('DEBUG');
    expect(formatCountLabelAsLevel('defaultCount')).toBe('DEFAULT');
    expect(formatCountLabelAsLevel('unknown')).toBe('DEFAULT');
  });

  it('returns emoji symbols for known levels', () => {
    expect(MONITOR_LEVEL_SYMBOLS.ERROR).toBe('🚨');
    expect(monitorLevelSymbol('warning')).toBe('⚠️');
    expect(monitorLevelSymbol('missing')).toBe('ℹ️');
  });

  it('formats integers without fractional digits', () => {
    expect(formatLevelCountNumber(12_345)).toBe('12,345');
    expect(formatLevelCountNumber(BigInt(42))).toBe('42');
  });

  it('builds level count entries from API record keys', () => {
    const counts = levelCountsFromRecord({
      warningCount: 1,
      errorCount: 2,
      debugCount: 0,
    });

    expect(counts).toEqual([
      { level: 'ERROR', count: 2, symbol: '🚨' },
      { level: 'WARNING', count: 1, symbol: '⚠️' },
      { level: 'DEBUG', count: 0, symbol: '🔍' },
    ]);
  });
});
