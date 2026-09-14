import type { MonitorSummaryView } from './types';

export type FormatDurationMsOptions = {
  /** 秒单位前是否插入空格（Turn tree `1.24 s` vs 列表 `1.2s`） */
  space?: boolean;
  /** 秒级时长的小数位数（列表 1 位、Observation / Turn tree 2 位） */
  secondsDigits?: number;
};

/** 毫秒时长单源格式化；调用方负责校验入参。 */
export function formatDurationMs(ms: number, options: FormatDurationMsOptions = {}): string {
  const { space = false, secondsDigits = 1 } = options;
  const unitSep = space ? ' ' : '';
  if (ms < 1000) return `${ms}${unitSep}ms`;
  return `${(ms / 1000).toFixed(secondsDigits)}${unitSep}s`;
}

function formatTokenCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** input → output (∑ total) 摘要；Monitor observation 与 TokenUsageBadge 共用。 */
export function formatTokenUsageLabel(input: number, output: number, total: number): string {
  return `${formatTokenCount(input)} → ${formatTokenCount(output)} (∑ ${formatTokenCount(total)})`;
}

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

/** Trace / Timeline 列表时长：`1.2s`（1 位小数、无空格）。 */
export function formatMonitorLatency(latencyMs?: number): string | null {
  if (latencyMs === undefined || !Number.isFinite(latencyMs)) return null;
  return formatDurationMs(latencyMs, { secondsDigits: 1 });
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

/** Observation 树行内时长：`6.88s`（2 位小数、无空格，与 Langfuse 列表一致）。 */
export function formatMonitorObservationDuration(latencyMs?: number): string | null {
  if (latencyMs === undefined || !Number.isFinite(latencyMs)) return null;
  return formatDurationMs(latencyMs, { secondsDigits: 2 });
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
    return formatTokenUsageLabel(input, output, input + output);
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
