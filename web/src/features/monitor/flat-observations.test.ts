import { describe, expect, it } from 'vitest';
import type { MonitorObservationView } from '@peri/ui';
import {
  buildMonitorTimelineSegments,
  buildObservationMetadata,
  flattenMonitorObservations,
  observationIoInput,
  observationIoOutput,
} from './flat-observations';

const NESTED: MonitorObservationView[] = [{
  id: 'root',
  name: 'agent-run',
  kind: 'SPAN',
  level: 'DEFAULT',
  latencyMs: 900,
  children: [{
    id: 'step-1',
    name: 'step-1',
    kind: 'GENERATION',
    level: 'DEFAULT',
    latencyMs: 700,
    model: 'gpt-4',
    inputPreview: '{"prompt":"hello"}',
    outputPreview: 'world',
    inputTruncated: true,
  }],
}];

describe('flattenMonitorObservations', () => {
  it('flattens nested observations with parent links and synthetic timestamps', () => {
    const flat = flattenMonitorObservations(NESTED, '2026-09-13T08:00:00.000Z');
    expect(flat).toHaveLength(2);
    expect(flat[0]).toMatchObject({
      id: 'root',
      parentId: null,
      type: 'SPAN',
      name: 'agent-run',
    });
    expect(flat[1]).toMatchObject({
      id: 'step-1',
      parentId: 'root',
      type: 'GENERATION',
      output: 'world',
    });
    expect(flat[0].startTime).toBe('2026-09-13T08:00:00.000Z');
    expect(flat[1].startTime).toBe('2026-09-13T08:00:00.900Z');
  });

  it('maps IO helpers and metadata for detail tabs', () => {
    const child = NESTED[0].children![0];
    expect(observationIoInput(child)).toEqual({ prompt: 'hello' });
    expect(observationIoOutput(child)).toBe('world');
    expect(buildObservationMetadata(child)).toMatchObject({
      id: 'step-1',
      kind: 'GENERATION',
      inputTruncated: true,
      model: 'gpt-4',
    });
  });

  it('builds timeline segments relative to the earliest observation start', () => {
    const flat = flattenMonitorObservations(NESTED, '2026-09-13T08:00:00.000Z');
    const segments = buildMonitorTimelineSegments(flat);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      id: 'root',
      kind: 'SPAN',
      startMs: 0,
      endMs: 900,
    });
    expect(segments[1]).toMatchObject({
      id: 'step-1',
      kind: 'GENERATION',
      startMs: 900,
      endMs: 1600,
    });
  });
});
