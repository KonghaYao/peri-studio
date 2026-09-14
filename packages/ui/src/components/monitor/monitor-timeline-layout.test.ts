import { describe, expect, it } from 'vitest';
import {
  buildMonitorTimelineDurationOpacity,
  layoutMonitorTimelineLanes,
  layoutMonitorTimelineTypeLanes,
  type MonitorTimelineSegment,
} from './monitor-timeline-layout';

const SEGMENTS: MonitorTimelineSegment[] = [
  { id: 'a', name: 'agent', kind: 'AGENT', startMs: 0, endMs: 1000 },
  { id: 'b', name: 'tool', kind: 'TOOL', startMs: 200, endMs: 800 },
  { id: 'c', name: 'event', kind: 'EVENT', startMs: 500, endMs: 500 },
];

describe('monitor-timeline-layout', () => {
  it('assigns non-overlapping lanes within a type group', () => {
    const overlapping: MonitorTimelineSegment[] = [
      { id: 't1', name: 'a', kind: 'TOOL', startMs: 0, endMs: 500 },
      { id: 't2', name: 'b', kind: 'TOOL', startMs: 200, endMs: 800 },
    ];
    const lanes = layoutMonitorTimelineLanes(overlapping, 1000);
    expect(lanes.find((segment) => segment.id === 't1')?.lane).toBe(0);
    expect(lanes.find((segment) => segment.id === 't2')?.lane).toBe(1);
  });

  it('extends running segments to the timeline boundary', () => {
    const lanes = layoutMonitorTimelineLanes(
      [{ id: 'run', name: 'gen', kind: 'GENERATION', startMs: 100, endMs: 100, running: true }],
      2000,
    );
    expect(lanes[0]?.endMs).toBe(2000);
    expect(lanes[0]?.running).toBe(true);
  });

  it('treats EVENT as an instant marker', () => {
    const lanes = layoutMonitorTimelineLanes(
      [{ id: 'evt', name: 'hit', kind: 'EVENT', startMs: 400, endMs: 400 }],
      1000,
    );
    expect(lanes[0]?.endMs).toBe(400);
    expect(lanes[0]?.running).toBe(false);
  });

  it('groups segments by kind in stable order', () => {
    const groups = layoutMonitorTimelineTypeLanes(SEGMENTS, 1000);
    expect(groups.map((group) => group.kind)).toEqual(['AGENT', 'TOOL', 'EVENT']);
    expect(groups[0]?.segments).toHaveLength(1);
  });

  it('appends unknown kinds after the known display order', () => {
    const groups = layoutMonitorTimelineTypeLanes(
      [
        { id: 'x', name: 'custom', kind: 'CUSTOM', startMs: 0, endMs: 100 },
        { id: 'a', name: 'agent', kind: 'AGENT', startMs: 0, endMs: 100 },
      ],
      1000,
    );
    expect(groups.map((group) => group.kind)).toEqual(['AGENT', 'CUSTOM']);
  });

  it('returns no groups for empty input', () => {
    expect(layoutMonitorTimelineTypeLanes([], 1000)).toEqual([]);
  });

  it('builds duration opacity function', () => {
    const opacity = buildMonitorTimelineDurationOpacity([10, 100, 1000, 5000]);
    expect(opacity(100)).toBeGreaterThan(0);
    expect(opacity(100)).toBeLessThanOrEqual(1);
    expect(buildMonitorTimelineDurationOpacity([5, 5])).toBeTypeOf('function');
  });
});
