import type { MonitorTraceObservationFlat } from './build-trace-turn-tree';
import { formatDurationMs } from './format';

/** fuse `estimateTokens`：字符数 / 4 粗估。 */
export function estimateMonitorTraceOutputTokens(text: string | null | undefined): number | null {
  if (!text) return null;
  return Math.max(1, Math.round(text.length / 4));
}

export function formatMonitorTraceClockTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

/** Turn tree 节点时长：`123 ms` / `1.24 s`（2 位小数、有空格）。 */
export function formatMonitorTraceDuration(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): string {
  if (!startTime || !endTime) return '—';
  const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return formatDurationMs(ms, { space: true, secondsDigits: 2 });
}

export function formatMonitorTraceCompactTokens(count: number | null | undefined): string {
  if (count === null || count === undefined || !Number.isFinite(count)) return '—';
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(count);
}

export function monitorTraceToolOutputTokens(observation: MonitorTraceObservationFlat): number | null {
  if (observation.type.toUpperCase() !== 'TOOL' || observation.output == null) return null;
  const text = typeof observation.output === 'string'
    ? observation.output
    : JSON.stringify(observation.output);
  return estimateMonitorTraceOutputTokens(text);
}
