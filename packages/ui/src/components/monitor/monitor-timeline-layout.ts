import type { MonitorObservationLevel } from './types';

/** 时间轴上的一个观测段（相对 trace 起点的毫秒坐标）。 */
export type MonitorTimelineSegment = {
  id: string;
  name: string;
  kind: string;
  level?: MonitorObservationLevel;
  startMs: number;
  endMs: number;
  running?: boolean;
  tokens?: number;
  traceIndex?: number;
  statusMessage?: string;
  isSubagent?: boolean;
};

export type MonitorTimelineBandSegment = MonitorTimelineSegment & {
  lane: number;
};

export type MonitorTimelineTypeLaneGroup = {
  kind: string;
  segments: MonitorTimelineBandSegment[];
  laneCount: number;
};

/** 已知 observation type 的稳定显示顺序。 */
export const MONITOR_TIMELINE_TYPE_ORDER = [
  'AGENT',
  'CHAIN',
  'GENERATION',
  'TOOL',
  'RETRIEVER',
  'EVALUATOR',
  'EMBEDDING',
  'GUARDRAIL',
  'SPAN',
  'EVENT',
] as const;

/**
 * 将同 type 的观测分配到不重叠的垂直 lane。
 * `running` 段延伸到 `totalMs` 边界。
 */
export function layoutMonitorTimelineLanes(
  segments: MonitorTimelineSegment[],
  totalMs: number,
): MonitorTimelineBandSegment[] {
  const items = segments
    .map((segment) => {
      const isInstant =
        segment.kind === 'EVENT' || (!segment.running && segment.endMs <= segment.startMs);
      return {
        ...segment,
        endMs: isInstant ? segment.startMs : (segment.running ? totalMs : segment.endMs),
        running: !isInstant && segment.running === true,
      };
    })
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const laneEnds: number[] = [];
  return items.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.startMs);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = item.endMs;
    return { ...item, lane };
  });
}

/** 按 type 分组并计算每组 lane 数。 */
export function layoutMonitorTimelineTypeLanes(
  segments: MonitorTimelineSegment[],
  totalMs: number,
): MonitorTimelineTypeLaneGroup[] {
  const byKind = new Map<string, MonitorTimelineSegment[]>();
  for (const segment of segments) {
    const kind = segment.kind.trim().toUpperCase();
    const bucket = byKind.get(kind) ?? [];
    bucket.push(segment);
    byKind.set(kind, bucket);
  }

  const groups: MonitorTimelineTypeLaneGroup[] = [];
  const pushGroup = (kind: string) => {
    const bucket = byKind.get(kind);
    if (!bucket || bucket.length === 0) return;
    const laidOut = layoutMonitorTimelineLanes(bucket, totalMs);
    const laneCount = laidOut.reduce((max, segment) => Math.max(max, segment.lane + 1), 0);
    groups.push({ kind, segments: laidOut, laneCount });
  };

  for (const kind of MONITOR_TIMELINE_TYPE_ORDER) pushGroup(kind);
  for (const kind of byKind.keys()) {
    if (!MONITOR_TIMELINE_TYPE_ORDER.includes(kind as typeof MONITOR_TIMELINE_TYPE_ORDER[number])) {
      pushGroup(kind);
    }
  }
  return groups;
}

export type MonitorTimelineDurationOpacity = (durationMs: number) => number;

const OPACITY_MIN = 0.25;
const OPACITY_MAX = 0.95;
const OPACITY_FLAT = 0.65;
const MAD_TO_SIGMA = 1.4826;
const Z_CLAMP = 2.5;

/** 时长 → 透明度（heat map）；算法自 peri-fuse observation timeline 移植。 */
export function buildMonitorTimelineDurationOpacity(durationsMs: number[]): MonitorTimelineDurationOpacity {
  const xs = durationsMs
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.log10(value + 1));
  if (xs.length < 3) return () => OPACITY_FLAT;
  xs.sort((a, b) => a - b);
  const median = xs[Math.floor(xs.length / 2)];
  const deviations = xs.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)];
  if (mad < 1e-9) return () => OPACITY_FLAT;
  const scale = mad * MAD_TO_SIGMA;
  return (durationMs) => {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return OPACITY_MIN;
    const z = (Math.log10(durationMs + 1) - median) / scale;
    const clamped = Math.max(-Z_CLAMP, Math.min(Z_CLAMP, z));
    return OPACITY_MIN + (OPACITY_MAX - OPACITY_MIN) * ((clamped + Z_CLAMP) / (2 * Z_CLAMP));
  };
}

export function monitorTimelineNiceTickStep(targetMs: number): number {
  const base = 10 ** Math.floor(Math.log10(targetMs));
  for (const multiplier of [1, 2, 5, 10]) {
    if (base * multiplier >= targetMs) return base * multiplier;
  }
  return base * 10;
}

export function formatMonitorTimelineTickLabel(ms: number, stepMs: number): string {
  if (stepMs < 1000) return `${ms} ms`;
  if (stepMs < 60_000) return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export const MONITOR_TIMELINE_LANE_HEIGHT = 26;
export const MONITOR_TIMELINE_BLOCK_HEIGHT = 18;
export const MONITOR_TIMELINE_LABEL_WIDTH = 64;
export const MONITOR_TIMELINE_GROUP_GAP = 8;
export const MONITOR_TIMELINE_TICK_TARGET_PX = 90;

export const MONITOR_TIMELINE_BAR_COLORS: Record<string, string> = {
  SPAN: 'bg-accent-solid/70',
  EVENT: 'bg-success/80',
  GENERATION: 'bg-danger/70',
  AGENT: 'bg-accent-solid/70',
  TOOL: 'bg-warning/70',
  CHAIN: 'bg-danger/70',
  RETRIEVER: 'bg-success/70',
  EVALUATOR: 'bg-accent-solid/70',
  EMBEDDING: 'bg-warning/70',
  GUARDRAIL: 'bg-danger/70',
};

export const MONITOR_TIMELINE_BAR_FALLBACK = 'bg-content-muted/50';

export const MONITOR_TIMELINE_TRACE_COLORS = [
  'bg-warning',
  'bg-accent-solid',
  'bg-danger',
  'bg-success',
  'bg-accent-solid',
  'bg-warning',
] as const;
