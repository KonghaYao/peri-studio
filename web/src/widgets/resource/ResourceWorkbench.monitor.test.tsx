import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResourceWorkbench } from './ResourceWorkbench';
import { setProjects, setProjectSessions, setSelectedSessionId } from '@/store';

const fetchSessionTraces = vi.hoisted(() => vi.fn());
const fetchTraceDetail = vi.hoisted(() => vi.fn());

vi.mock('@/features/monitor/use-monitor-capability', () => ({
  useMonitorCapability: () => () => true,
}));

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
  setProjects([{
    id: 'project-1',
    name: 'Peri',
    cwd: '/workspace/peri',
    instanceId: 'local',
    createdAt: null,
    updatedAt: null,
    archivedAt: null,
  }]);
  setProjectSessions([{
    id: 'acp-session-1',
    projectId: 'project-1',
    acpSessionId: 'acp-session-1',
    title: 'Work',
    lifecycle: 'ready',
    updatedAt: null,
    lastOpenedAt: null,
    activeChatId: null,
    archivedAt: null,
  }]);
  setSelectedSessionId('acp-session-1');
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  vi.stubGlobal('setInterval', (handler: TimerHandler, timeout?: number) => {
    void handler;
    void timeout;
    return 1 as unknown as ReturnType<typeof setInterval>;
  });
  vi.stubGlobal('clearInterval', vi.fn());
});

afterEach(() => {
  cleanup();
  setProjects([]);
  setProjectSessions([]);
  setSelectedSessionId(null);
  vi.unstubAllGlobals();
});

describe('ResourceWorkbench monitor surface', () => {
  it('mounts the new monitor trace turn tree drill-in from the workbench panel', async () => {
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
          latencyMs: 900,
          children: [{
            id: 'step-1',
            name: 'step-1',
            kind: 'GENERATION',
            level: 'DEFAULT',
            latencyMs: 700,
            inputPreview: '{"prompt":"hello"}',
            outputPreview: 'world',
          }],
        }],
      },
    });

    render(() => <ResourceWorkbench view="monitor" />);

    await waitFor(() => {
      expect(screen.getByTestId('monitor-panel')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('monitor-trace-detail-shell')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByTestId('monitor-trace-trace-1'));
    await waitFor(() => {
      expect(screen.getByTestId('monitor-trace-detail')).toBeInTheDocument();
      expect(screen.getByTestId('monitor-trace-turn-tree-shell')).toBeInTheDocument();
      expect(screen.getByTestId('monitor-trace-turn-node-agent-run')).toBeInTheDocument();
      expect(screen.getByTestId('monitor-trace-timeline')).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByTestId('monitor-timeline-block-step-1'));
    await waitFor(() => {
      expect(screen.getByTestId('monitor-observation-detail')).toBeInTheDocument();
      expect(screen.getByTestId('io-viewer-shell')).toBeInTheDocument();
    });
  });
});
