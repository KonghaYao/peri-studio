import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonitorPanelShell } from './MonitorPanelShell';
import type { MonitorSummaryView, MonitorTraceRowView } from './types';

const SUMMARY: MonitorSummaryView = {
  traceCount: 12,
  totalTokens: 48200,
  totalCostUsd: 0.042,
  lastTimestamp: new Date(Date.now() - 120_000).toISOString(),
};

const TRACES: MonitorTraceRowView[] = [
  {
    id: 'trace-1',
    name: 'turn',
    timestamp: '2026-09-13T08:00:00.000Z',
    latencyMs: 1200,
    tokens: 4100,
    costUsd: 0.003,
    level: 'DEFAULT',
  },
  {
    id: 'trace-2',
    name: '',
    timestamp: '2026-09-13T07:55:00.000Z',
    latencyMs: 800,
    tokens: 2200,
    level: 'ERROR',
  },
];

afterEach(() => cleanup());

describe('MonitorPanelShell', () => {
  it('renders loading state', () => {
    render(() => <MonitorPanelShell state="loading" traces={[]} />);
    expect(screen.getByRole('status', { name: 'Loading traces…' })).toBeInTheDocument();
  });

  it('renders empty session state', () => {
    render(() => <MonitorPanelShell state="empty-session" traces={[]} />);
    expect(screen.getByText('Select a project session to view traces.')).toBeInTheDocument();
  });

  it('renders empty traces state with hint', () => {
    render(() => <MonitorPanelShell state="empty-traces" traces={[]} />);
    expect(screen.getByText('No traces yet for this session.')).toBeInTheDocument();
    expect(screen.getByText(/Traces appear after the agent reports to Langfuse/)).toBeInTheDocument();
  });

  it('renders error state with retry', async () => {
    const onRetry = vi.fn();
    render(() => (
      <MonitorPanelShell
        state="error"
        traces={[]}
        errorMessage="Upstream timeout"
        onRetry={onRetry}
      />
    ));
    expect(screen.getByText('Upstream timeout')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders summary and clickable trace list', async () => {
    const onTraceSelect = vi.fn();
    render(() => (
      <MonitorPanelShell
        state="ready"
        summary={SUMMARY}
        traces={TRACES}
        onTraceSelect={onTraceSelect}
      />
    ));
    expect(screen.getByTestId('monitor-summary')).toHaveTextContent('12 traces');
    expect(screen.getByTestId('monitor-summary')).toHaveTextContent('48,200 tokens');
    expect(screen.getByTestId('monitor-trace-trace-1')).toHaveTextContent('turn');
    expect(screen.getByTestId('monitor-trace-trace-2')).toHaveTextContent('Untitled trace');
    expect(screen.getByTestId('monitor-trace-trace-2')).toHaveTextContent('Error');
    await fireEvent.click(screen.getByTestId('monitor-trace-trace-1'));
    expect(onTraceSelect).toHaveBeenCalledWith(TRACES[0]);
  });

  it('applies embedded flex layout', () => {
    render(() => <MonitorPanelShell embedded state="loading" traces={[]} />);
    expect(screen.getByTestId('monitor-panel-shell')).toHaveClass('min-h-0', 'flex-1');
  });
});
