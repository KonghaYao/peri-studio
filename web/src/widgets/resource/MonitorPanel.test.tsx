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

vi.mock('@/features/monitor/session', () => ({
  fetchSessionTraces: (...args: unknown[]) => fetchSessionTraces(...args),
}));

beforeEach(() => {
  fetchSessionTraces.mockReset();
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
        langfuseUrl: 'https://cloud.langfuse.com/project/p/sessions/acp-session-1',
      },
    });
    render(() => <MonitorPanel embedded visible />);
    await waitFor(() => {
      expect(screen.getByTestId('monitor-trace-trace-1')).toBeInTheDocument();
    });
    expect(fetchSessionTraces).toHaveBeenCalledWith('acp-session-1', expect.any(Object));
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

  it('does not start polling when turn is inactive', async () => {
    const setIntervalSpy = vi.fn().mockReturnValue(1);
    vi.stubGlobal('setInterval', setIntervalSpy);
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
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});
