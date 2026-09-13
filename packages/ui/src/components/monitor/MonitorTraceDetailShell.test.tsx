import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonitorTraceDetailShell } from './MonitorTraceDetailShell';
import type { MonitorObservationView } from './types';

const OBSERVATIONS: MonitorObservationView[] = [
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
        level: 'DEFAULT',
        model: 'gpt-4',
        tokens: 1200,
      },
    ],
  },
];

afterEach(() => cleanup());

describe('MonitorTraceDetailShell', () => {
  it('renders loading state', () => {
    render(() => (
      <MonitorTraceDetailShell traceName="turn" observations={[]} state="loading" />
    ));
    expect(screen.getByRole('status', { name: 'Loading trace…' })).toBeInTheDocument();
  });

  it('renders observation tree and handles back', async () => {
    const onBack = vi.fn();
    render(() => (
      <MonitorTraceDetailShell
        traceName="turn"
        observations={OBSERVATIONS}
        state="ready"
        onBack={onBack}
      />
    ));
    expect(screen.getByText('turn')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-observation-root')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-observation-child')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Back to traces' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('drills into observation detail and returns to tree', async () => {
    const onObservationBack = vi.fn();
    const child = OBSERVATIONS[0].children![0];
    render(() => (
      <MonitorTraceDetailShell
        traceName="turn"
        observations={OBSERVATIONS}
        state="ready"
        selectedObservation={child}
        onObservationBack={onObservationBack}
        onObservationSelect={() => {}}
      />
    ));
    expect(screen.getByTestId('monitor-observation-detail')).toBeInTheDocument();
    expect(screen.getByText('llm')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Back to observations' }));
    expect(onObservationBack).toHaveBeenCalledTimes(1);
  });
});
