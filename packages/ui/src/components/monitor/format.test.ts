import { describe, expect, it } from 'vitest';
import {
  formatMonitorCostUsd,
  formatMonitorLastActivity,
  formatMonitorObservationDuration,
  formatMonitorObservationTokens,
  formatMonitorTraceCount,
  formatMonitorTraceMeta,
  monitorSummaryItems,
} from './format';

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

  it('formats observation duration and token summary', () => {
    expect(formatMonitorObservationDuration(6880)).toBe('6.88s');
    expect(formatMonitorObservationDuration(450)).toBe('450ms');
    expect(formatMonitorObservationTokens({
      kind: 'GENERATION',
      inputTokens: 24538,
      outputTokens: 70,
    })).toBe('24,538 → 70 (Σ 24,608)');
    expect(formatMonitorObservationTokens({
      kind: 'GENERATION',
      tokens: 1200,
    })).toBe('1,200 tok');
  });
});
