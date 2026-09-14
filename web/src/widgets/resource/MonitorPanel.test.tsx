import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { MonitorPanel } from './MonitorPanel';

const storeMocks = vi.hoisted(() => ({
  selectedSessionId: vi.fn(() => 'acp-session-1' as string | null),
  turnActive: vi.fn(() => false),
}));

vi.mock('@/store', () => storeMocks);

const fetchSessionTraces = vi.hoisted(() => vi.fn());
const fetchTraceDetail = vi.hoisted(() => vi.fn());

vi.mock('@/features/monitor/session', () => ({
  fetchSessionTraces: (...args: unknown[]) => fetchSessionTraces(...args),
}));

vi.mock('@/features/monitor/trace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/monitor/trace')>();
  return {
    ...actual,
    fetchTraceDetail: (...args: unknown[]) => fetchTraceDetail(...args),
  };
});

beforeEach(() => {
  fetchSessionTraces.mockReset();
  fetchTraceDetail.mockReset();
  storeMocks.selectedSessionId.mockReturnValue('acp-session-1');
  storeMocks.turnActive.mockReturnValue(false);
  vi.stubGlobal('setInterval', (handler: TimerHandler, timeout?: number) => {
    void handler;
    void timeout;
    return 1 as unknown as ReturnType<typeof setInterval>;
  });
  vi.stubGlobal('clearInterval', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MonitorPanel', () => {
  it('shows empty session state without fetching', async () => {
    storeMocks.selectedSessionId.mockReturnValue(null);
    render(() => <MonitorPanel embedded visible />);
    await waitFor(() => {
      expect(screen.getByText('Select a project session to view traces.')).toBeInTheDocument();
    });
    expect(fetchSessionTraces).not.toHaveBeenCalled();
  });

  it('loads traces for the selected session', async () => {
    fetchSessionTraces.mockResolvedValue({
      ok: true,
      data: {
        sessionId: 'acp-session-1',
        configured: true,
        found: true,
        summary: { traceCount: 1, totalTokens: 100 },
        traces: [{
          id: 'trace-1',
          name: 'turn',
          timestamp: '2026-09-13T08:00:00.000Z',
          level: 'DEFAULT',
        }],
      },
    });
    render(() => <MonitorPanel embedded visible />);
    await waitFor(() => {
      expect(screen.getByTestId('monitor-trace-trace-1')).toBeInTheDocument();
    });
    expect(fetchSessionTraces).toHaveBeenCalledWith('acp-session-1', expect.any(Object));
  });

  it('drills into a trace observation tree', async () => {
    fetchSessionTraces.mockResolvedValue({
      ok: true,
      data: {
        sessionId: 'acp-session-1',
        configured: true,
        found: true,
        summary: { traceCount: 1, totalTokens: 100 },
        traces: [{
          id: 'trace-1',
          name: 'turn',
          timestamp: '2026-09-13T08:00:00.000Z',
          level: 'DEFAULT',
        }],
      },
    });
    fetchTraceDetail.mockResolvedValue({
      ok: true,
      data: {
        sessionId: 'acp-session-1',
        traceId: 'trace-1',
        name: 'turn',
        observations: [{
          id: 'root',
          name: 'agent',
          kind: 'SPAN',
          level: 'DEFAULT',
        }],
      },
    });
    render(() => <MonitorPanel embedded visible />);
    await waitFor(() => {
      expect(screen.getByTestId('monitor-trace-trace-1')).toBeInTheDocument();
    });
    await fireEvent.click(screen.getByTestId('monitor-trace-trace-1'));
    await waitFor(() => {
      expect(screen.getByTestId('monitor-trace-detail')).toBeInTheDocument();
      expect(screen.getByTestId('monitor-trace-turn-node-root')).toBeInTheDocument();
    });
    expect(fetchTraceDetail).toHaveBeenCalledWith('acp-session-1', 'trace-1', expect.any(Object));
    await fireEvent.click(screen.getByRole('button', { name: 'Back to traces' }));
    await waitFor(() => {
      expect(screen.getByTestId('monitor-panel')).toBeInTheDocument();
    });
  });

  it('renders timeline when observation timestamps are available', async () => {
    fetchSessionTraces.mockResolvedValue({
      ok: true,
      data: {
        sessionId: 'acp-session-1',
        configured: true,
        found: true,
        summary: { traceCount: 1, totalTokens: 100 },
        traces: [{
          id: 'trace-1',
          name: 'turn',
          timestamp: '2026-09-13T08:00:00.000Z',
          level: 'DEFAULT',
        }],
      },
    });
    fetchTraceDetail.mockResolvedValue({
      ok: true,
      data: {
        sessionId: 'acp-session-1',
        traceId: 'trace-1',
        name: 'turn',
        observations: [{
          id: 'root',
          name: 'agent',
          kind: 'SPAN',
          level: 'DEFAULT',
          latencyMs: 900,
        }],
      },
    });
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
    render(() => <MonitorPanel embedded visible />);
    await waitFor(() => {
      expect(screen.getByTestId('monitor-trace-trace-1')).toBeInTheDocument();
    });
    await fireEvent.click(screen.getByTestId('monitor-trace-trace-1'));
    await waitFor(() => {
      expect(screen.getByTestId('monitor-trace-timeline')).toBeInTheDocument();
      expect(screen.getByTestId('monitor-timeline-shell')).toBeInTheDocument();
      expect(screen.getByTestId('monitor-timeline-block-root')).toBeInTheDocument();
    });
  });

  it('drills into observation detail and returns to tree without full prompt in list', async () => {
    fetchSessionTraces.mockResolvedValue({
      ok: true,
      data: {
        sessionId: 'acp-session-1',
        configured: true,
        found: true,
        summary: { traceCount: 1, totalTokens: 100 },
        traces: [{
          id: 'trace-1',
          name: 'turn',
          timestamp: '2026-09-13T08:00:00.000Z',
          level: 'DEFAULT',
        }],
      },
    });
    fetchTraceDetail.mockResolvedValue({
      ok: true,
      data: {
        sessionId: 'acp-session-1',
        traceId: 'trace-1',
        name: 'turn',
        observations: [{
          id: 'agent-run',
          name: 'agent-run',
          kind: 'SPAN',
          level: 'DEFAULT',
          children: [{
            id: 'step-1',
            name: 'step-1',
            kind: 'GENERATION',
            level: 'DEFAULT',
            model: 'gpt-4',
            inputPreview: 'secret prompt body',
            outputPreview: 'secret output body',
          }],
        }],
      },
    });
    render(() => <MonitorPanel embedded visible />);
    await waitFor(() => {
      expect(screen.getByTestId('monitor-trace-trace-1')).toBeInTheDocument();
    });
    await fireEvent.click(screen.getByTestId('monitor-trace-trace-1'));
    await waitFor(() => {
      expect(screen.getByTestId('monitor-trace-turn-node-agent-run')).toBeInTheDocument();
    });
    expect(screen.queryByText('secret prompt body')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByTestId('monitor-trace-turn-node-step-1'));
    await waitFor(() => {
      expect(screen.getByTestId('monitor-observation-detail')).toBeInTheDocument();
      expect(screen.getByTestId('io-viewer-shell')).toBeInTheDocument();
      expect(screen.getByText('secret prompt body')).toBeInTheDocument();
    });
    await fireEvent.click(screen.getByTestId('monitor-trace-turn-tree-root'));
    await waitFor(() => {
      expect(screen.getByText('Trace root')).toBeInTheDocument();
      expect(screen.queryByText('secret prompt body')).not.toBeInTheDocument();
    });
  });

  it('retries after an error', async () => {
    fetchSessionTraces
      .mockResolvedValueOnce({
        ok: false,
        error: 'langfuse_upstream_timeout',
        message: "Couldn't load traces.",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          sessionId: 'acp-session-1',
          configured: true,
          found: false,
          summary: { traceCount: 0, totalTokens: 0 },
          traces: [],
        },
      });
    render(() => <MonitorPanel embedded visible />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByText('No traces yet for this session.')).toBeInTheDocument();
    });
    expect(fetchSessionTraces).toHaveBeenCalledTimes(2);
  });

  it('reloads when refreshToken changes', async () => {
    fetchSessionTraces.mockResolvedValue({
      ok: true,
      data: {
        sessionId: 'acp-session-1',
        configured: true,
        found: false,
        summary: { traceCount: 0, totalTokens: 0 },
        traces: [],
      },
    });
    const [refreshToken, setRefreshToken] = createSignal(0);
    render(() => <MonitorPanel embedded visible refreshToken={refreshToken()} />);
    await waitFor(() => expect(fetchSessionTraces).toHaveBeenCalledTimes(1));
    setRefreshToken(1);
    await waitFor(() => expect(fetchSessionTraces).toHaveBeenCalledTimes(2));
  });

  it('starts monitor polling only while turn is active', async () => {
    const intervals: number[] = [];
    vi.stubGlobal('setInterval', (_handler: TimerHandler, ms?: number) => {
      intervals.push(ms ?? 0);
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    fetchSessionTraces.mockResolvedValue({
      ok: true,
      data: {
        sessionId: 'acp-session-1',
        configured: true,
        found: false,
        summary: { traceCount: 0, totalTokens: 0 },
        traces: [],
      },
    });
    render(() => <MonitorPanel embedded visible />);
    await waitFor(() => expect(fetchSessionTraces).toHaveBeenCalledTimes(1));
    expect(intervals).not.toContain(15_000);

    storeMocks.turnActive.mockReturnValue(true);
    render(() => <MonitorPanel embedded visible />);
    await waitFor(() => expect(intervals).toContain(15_000));
  });
});
