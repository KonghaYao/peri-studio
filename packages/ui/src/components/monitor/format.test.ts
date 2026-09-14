import { describe, expect, it } from 'vitest';
import {
  formatDurationMs,
  formatMonitorCostUsd,
  formatMonitorLastActivity,
  formatMonitorLatency,
  formatMonitorObservationDuration,
  formatMonitorObservationTokens,
  formatMonitorTraceCount,
  formatMonitorTraceMeta,
  formatTokenUsageLabel,
  monitorSummaryItems,
} from './format';
import { formatMonitorTraceDuration } from './trace-turn-tree-format';

describe('monitor format helpers', () => {
  it('formats summary labels', () => {
    expect(formatMonitorTraceCount(12)).toBe('12 traces');
    expect(formatMonitorCostUsd(0.042)).toBe('$0.042');
    expect(formatMonitorCostUsd(0.0012)).toBe('$0.0012');
  });

  it('builds summary items with optional cost and last activity', () => {
    const now = Date.parse('2026-09-13T10:02:00.000Z');
    const items = monitorSummaryItems({
      traceCount: 2,
      totalTokens: 1000,
      totalCostUsd: 0.01,
      lastTimestamp: '2026-09-13T10:00:00.000Z',
    }, now);
    expect(items).toEqual(['2 traces', '1,000 tokens', '$0.010', 'Last activity 2m ago']);
  });

  it('formats trace row meta', () => {
    expect(formatMonitorTraceMeta({ latencyMs: 1200, tokens: 4100, costUsd: 0.003 })).toBe(
      '1.2s · 4,100 tok · $0.0030',
    );
  });

  it('formats last activity relative time', () => {
    const now = Date.parse('2026-09-13T10:00:00.000Z');
    expect(formatMonitorLastActivity('2026-09-13T09:30:00.000Z', now)).toBe('Last activity 30m ago');
  });

  it('formats duration variants from a single helper', () => {
    expect(formatDurationMs(450)).toBe('450ms');
    expect(formatDurationMs(1200, { secondsDigits: 1 })).toBe('1.2s');
    expect(formatDurationMs(1240, { space: true, secondsDigits: 2 })).toBe('1.24 s');
    expect(formatMonitorLatency(1200)).toBe('1.2s');
    expect(formatMonitorObservationDuration(6880)).toBe('6.88s');
    expect(formatMonitorObservationDuration(450)).toBe('450ms');
    expect(formatMonitorTraceDuration('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.240Z')).toBe('1.24 s');
    expect(formatMonitorTraceDuration('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.450Z')).toBe('450 ms');
  });

  it('formats token usage label and observation summary', () => {
    expect(formatTokenUsageLabel(24538, 70, 24608)).toBe('24,538 → 70 (∑ 24,608)');
    expect(formatMonitorObservationTokens({
      kind: 'GENERATION',
      inputTokens: 24538,
      outputTokens: 70,
    })).toBe('24,538 → 70 (∑ 24,608)');
    expect(formatMonitorObservationTokens({
      kind: 'GENERATION',
      tokens: 1200,
    })).toBe('1,200 tok');
  });
});
