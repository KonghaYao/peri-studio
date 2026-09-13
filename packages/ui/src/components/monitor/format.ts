import type { MonitorSummaryView } from './types';

export function formatMonitorTraceCount(count: number): string {
  return `${count.toLocaleString()} traces`;
}

export function formatMonitorTokenCount(count: number): string {
  return `${count.toLocaleString()} tokens`;
}

export function formatMonitorCostUsd(amount: number): string {
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(3)}`;
}

export function formatMonitorRelativeTime(value: string | undefined, now: number = Date.now()): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatMonitorLastActivity(value: string | undefined, now?: number): string | null {
  const relative = formatMonitorRelativeTime(value, now);
  return relative ? `Last activity ${relative}` : null;
}

export function formatMonitorLatency(latencyMs?: number): string | null {
  if (latencyMs === undefined || !Number.isFinite(latencyMs)) return null;
  if (latencyMs < 1000) return `${latencyMs}ms`;
  return `${(latencyMs / 1000).toFixed(1)}s`;
}

export function formatMonitorTraceMeta(
  trace: { latencyMs?: number; tokens?: number; costUsd?: number },
): string {
  const parts: string[] = [];
  const latency = formatMonitorLatency(trace.latencyMs);
  if (latency) parts.push(latency);
  if (trace.tokens !== undefined && Number.isFinite(trace.tokens)) {
    parts.push(`${trace.tokens.toLocaleString()} tok`);
  }
  if (trace.costUsd !== undefined && Number.isFinite(trace.costUsd)) {
    parts.push(formatMonitorCostUsd(trace.costUsd));
  }
  return parts.join(' · ');
}

export function monitorSummaryItems(summary: MonitorSummaryView, now?: number): string[] {
  const items = [
    formatMonitorTraceCount(summary.traceCount),
    formatMonitorTokenCount(summary.totalTokens),
  ];
  if (summary.totalCostUsd !== undefined && Number.isFinite(summary.totalCostUsd)) {
    items.push(formatMonitorCostUsd(summary.totalCostUsd));
  }
  const lastActivity = formatMonitorLastActivity(summary.lastTimestamp, now);
  if (lastActivity) items.push(lastActivity);
  return items;
}
