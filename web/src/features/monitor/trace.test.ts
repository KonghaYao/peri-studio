import { describe, expect, it, vi } from 'vitest';
import {
  fetchTraceDetail,
  findObservationById,
  monitorTraceErrorMessage,
  parseMonitorTraceDto,
  stripObservationsForTree,
} from './trace';

describe('monitor trace', () => {
  it('parses a valid trace DTO with nested observations', () => {
    const dto = parseMonitorTraceDto({
      sessionId: 'acp-1',
      traceId: 'trace-1',
      name: 'turn',
      observations: [
        {
          id: 'root',
          name: 'agent',
          kind: 'SPAN',
          latencyMs: 900,
          level: 'DEFAULT',
          children: [
            {
              id: 'child',
              name: 'llm',
              kind: 'GENERATION',
              latencyMs: 700,
              model: 'gpt-4',
              tokens: 1200,
              level: 'DEFAULT',
            },
          ],
        },
      ],
    });
    expect(dto?.traceId).toBe('trace-1');
    expect(dto?.observations).toHaveLength(1);
    expect(dto?.observations[0].children).toHaveLength(1);
  });

  it('parses bounded IO and score detail fields', () => {
    const dto = parseMonitorTraceDto({
      sessionId: 'acp-1',
      traceId: 'trace-1',
      name: 'turn',
      observations: [{
        id: 'gen',
        name: 'step-1',
        kind: 'GENERATION',
        level: 'DEFAULT',
        inputPreview: '{"prompt":"hello"}',
        outputPreview: 'world',
        inputTruncated: true,
        children: [{
          id: 'score-1',
          name: 'cache-hit-rate-low',
          kind: 'SCORE',
          level: 'DEFAULT',
          scoreValue: '0.42',
          scoreDataType: 'NUMERIC',
        }],
      }],
    });
    const generation = dto?.observations[0];
    expect(generation?.inputPreview).toBe('{"prompt":"hello"}');
    expect(generation?.inputTruncated).toBe(true);
    expect(generation?.children?.[0].scoreValue).toBe('0.42');
    const tree = stripObservationsForTree(dto!.observations);
    expect(tree[0].inputPreview).toBeUndefined();
    expect(tree[0].children?.[0].scoreValue).toBeUndefined();
    expect(findObservationById(dto!.observations, 'score-1')?.name).toBe('cache-hit-rate-low');
  });

  it('maps stable server error codes', () => {
    expect(monitorTraceErrorMessage('trace_not_found')).toBe("Couldn't load trace.");
    expect(monitorTraceErrorMessage('langfuse_upstream_timeout')).toBe("Couldn't load trace.");
  });

  it('fetches trace detail with same-origin credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionId: 'acp-1',
        traceId: 'trace-1',
        name: 'turn',
        observations: [],
      }),
    });
    const result = await fetchTraceDetail('acp-1', 'trace-1', { fetcher });
    expect(result.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/monitor/trace?sessionId=acp-1&traceId=trace-1',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });
});
