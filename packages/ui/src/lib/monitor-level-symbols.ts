/** Observation level emoji 映射（自 peri-fuse LevelSymbols；不含 Spectra 色表）。 */

export type MonitorLevelKey = 'DEFAULT' | 'DEBUG' | 'WARNING' | 'ERROR';

export const MONITOR_LEVEL_SYMBOLS: Record<MonitorLevelKey, string> = {
  DEFAULT: 'ℹ️',
  DEBUG: '🔍',
  WARNING: '⚠️',
  ERROR: '🚨',
};

const LEVEL_ORDER: MonitorLevelKey[] = ['ERROR', 'WARNING', 'DEBUG', 'DEFAULT'];

/** 将 API count 字段名（如 `errorCount`）规范为 observation level。 */
export function formatCountLabelAsLevel(countLabel: string): MonitorLevelKey {
  const normalized = countLabel.replace(/Count$/i, '').toUpperCase();
  if (normalized in MONITOR_LEVEL_SYMBOLS) {
    return normalized as MonitorLevelKey;
  }
  return 'DEFAULT';
}

export function monitorLevelSymbol(level: MonitorLevelKey | string): string {
  const key = level.toString().toUpperCase() as MonitorLevelKey;
  return MONITOR_LEVEL_SYMBOLS[key] ?? MONITOR_LEVEL_SYMBOLS.DEFAULT;
}

export function formatLevelCountNumber(value: number | bigint, fractionDigits = 0): string {
  const numeric = typeof value === 'bigint' ? Number(value) : value;
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(numeric);
}

export type LevelCountEntry = {
  level: string;
  count: number | bigint;
  symbol: string;
  customNumberFormatter?: (value: number | bigint) => string;
};

/** 将 `{ errorCount: 2, warningCount: 1 }` 转为 LevelCountsDisplay 输入。 */
export function levelCountsFromRecord(
  counts: Record<string, number | bigint>,
  order: readonly MonitorLevelKey[] = LEVEL_ORDER,
): LevelCountEntry[] {
  const entries = Object.entries(counts).map(([label, count]) => {
    const level = formatCountLabelAsLevel(label);
    return {
      level,
      count,
      symbol: monitorLevelSymbol(level),
    };
  });

  const rank = new Map(order.map((level, index) => [level, index]));
  return entries.sort((left, right) => {
    const leftRank = rank.get(left.level as MonitorLevelKey) ?? order.length;
    const rightRank = rank.get(right.level as MonitorLevelKey) ?? order.length;
    return leftRank - rightRank;
  });
}
