import type { MonitorObservationView, MonitorSummaryView } from './types';

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

export function formatMonitorTraceName(name: string | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : 'Untitled trace';
}

export function formatMonitorObservationMeta(
  observation: { kind?: string; latencyMs?: number; model?: string; tokens?: number; level?: string },
): string {
  const parts: string[] = [];
  if (observation.kind) parts.push(observation.kind);
  const latency = formatMonitorLatency(observation.latencyMs);
  if (latency) parts.push(latency);
  if (observation.model) parts.push(observation.model);
  if (observation.tokens !== undefined && Number.isFinite(observation.tokens)) {
    parts.push(`${observation.tokens.toLocaleString()} tok`);
  }
  if (observation.level === 'ERROR') parts.push('Error');
  return parts.join(' · ');
}

/** Observation 树行内时长（秒保留两位，与 Langfuse 列表一致）。 */
export function formatMonitorObservationDuration(latencyMs?: number): string | null {
  if (latencyMs === undefined || !Number.isFinite(latencyMs)) return null;
  if (latencyMs < 1000) return `${latencyMs}ms`;
  return `${(latencyMs / 1000).toFixed(2)}s`;
}

/** GENERATION 行 token 摘要：`input → output (Σ sum)`。 */
export function formatMonitorObservationTokens(
  observation: {
    kind?: string;
    tokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  },
): string | null {
  const input = observation.inputTokens;
  const output = observation.outputTokens;
  if (
    input !== undefined
    && output !== undefined
    && Number.isFinite(input)
    && Number.isFinite(output)
  ) {
    const sum = input + output;
    return `${input.toLocaleString()} → ${output.toLocaleString()} (Σ ${sum.toLocaleString()})`;
  }
  if (
    observation.kind?.toUpperCase() === 'GENERATION'
    && observation.tokens !== undefined
    && Number.isFinite(observation.tokens)
  ) {
    return `${observation.tokens.toLocaleString()} tok`;
  }
  return null;
}

export function formatMonitorObservationLevel(level: MonitorObservationView['level']): string {
  switch (level) {
    case 'ERROR':
      return 'Error';
    case 'WARNING':
      return 'Warning';
    case 'DEBUG':
      return 'Debug';
    default:
      return 'Default';
  }
}

/** 详情面板 token 行：`input → output (Σ sum)` 或 total。 */
export function formatMonitorObservationDetailTokens(
  observation: Pick<MonitorObservationView, 'tokens' | 'inputTokens' | 'outputTokens'>,
): string | null {
  const summary = formatMonitorObservationTokens(observation);
  if (summary) return summary;
  if (observation.tokens !== undefined && Number.isFinite(observation.tokens)) {
    return `${observation.tokens.toLocaleString()} tokens`;
  }
  return null;
}

export function hasMonitorObservationDetails(observation: MonitorObservationView): boolean {
  if (observation.inputPreview || observation.outputPreview) return true;
  if (observation.scoreValue || observation.scoreDataType) return true;
  if (observation.model) return true;
  if (observation.latencyMs !== undefined) return true;
  if (observation.inputTokens !== undefined || observation.outputTokens !== undefined) return true;
  if (observation.tokens !== undefined) return true;
  if (observation.level !== 'DEFAULT') return true;
  return false;
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
