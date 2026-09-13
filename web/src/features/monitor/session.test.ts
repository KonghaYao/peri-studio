import { describe, expect, it, vi } from 'vitest';
import {
  fetchSessionTraces,
  monitorSessionErrorMessage,
  parseMonitorSessionDto,
} from './session';

describe('monitor session', () => {
  it('parses a valid session DTO', () => {
    const dto = parseMonitorSessionDto({
      sessionId: 'acp-1',
      configured: true,
      found: true,
      summary: {
        traceCount: 2,
        totalTokens: 1000,
        totalCostUsd: 0.01,
        lastTimestamp: '2026-09-13T08:00:00.000Z',
      },
      traces: [
        {
          id: 'trace-1',
          name: 'turn',
          timestamp: '2026-09-13T08:00:00.000Z',
          latencyMs: 1200,
          tokens: 4100,
          costUsd: 0.003,
          level: 'DEFAULT',
        },
      ],
    });
    expect(dto?.sessionId).toBe('acp-1');
    expect(dto?.traces).toHaveLength(1);
    expect(dto?.summary.traceCount).toBe(2);
  });

  it('maps stable server error codes', () => {
    expect(monitorSessionErrorMessage('langfuse_upstream_timeout')).toBe("Couldn't load traces.");
    expect(monitorSessionErrorMessage('session_not_accessible')).toBe("Couldn't load traces.");
  });

  it('fetches session traces with same-origin credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionId: 'acp-1',
        configured: true,
        found: false,
        summary: { traceCount: 0, totalTokens: 0 },
        traces: [],
      }),
    });
    const result = await fetchSessionTraces('acp-1', { fetcher });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.found).toBe(false);
      expect(result.data.traces).toEqual([]);
    }
    expect(fetcher).toHaveBeenCalledWith(
      '/api/monitor/session?sessionId=acp-1',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });

  it('maps upstream failures to stable messages', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 504,
      json: async () => ({ error: 'langfuse_upstream_timeout' }),
    });
    const result = await fetchSessionTraces('acp-1', { fetcher });
    expect(result).toEqual({
      ok: false,
      error: 'langfuse_upstream_timeout',
      message: "Couldn't load traces.",
    });
  });

  it('rejects empty session ids without calling the API', async () => {
    const fetcher = vi.fn();
    const result = await fetchSessionTraces('   ', { fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('session_required');
  });
});
