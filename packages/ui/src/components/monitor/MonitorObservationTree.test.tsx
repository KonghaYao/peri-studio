import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonitorObservationTree } from './MonitorObservationTree';
import type { MonitorObservationView } from './types';

const OBSERVATIONS: MonitorObservationView[] = [
  {
    id: 'agent-run',
    name: 'agent-run',
    kind: 'SPAN',
    latencyMs: 6880,
    level: 'DEFAULT',
    children: [
      {
        id: 'stage-reason',
        name: 'stage-reason',
        kind: 'SPAN',
        latencyMs: 6850,
        level: 'DEFAULT',
        children: [
          {
            id: 'step-1',
            name: 'step-1',
            kind: 'GENERATION',
            latencyMs: 6850,
            level: 'DEFAULT',
            inputTokens: 24538,
            outputTokens: 70,
          },
        ],
      },
      {
        id: 'cache-hit-rate-low',
        name: 'cache-hit-rate-low',
        kind: 'SCORE',
        level: 'DEFAULT',
      },
    ],
  },
];

afterEach(() => cleanup());

describe('MonitorObservationTree', () => {
  it('renders nested observations with duration and token summary', () => {
    render(() => <MonitorObservationTree observations={OBSERVATIONS} />);
    expect(screen.getByText('agent-run')).toBeInTheDocument();
    expect(screen.getByText('6.88s')).toBeInTheDocument();
    expect(screen.getByText('stage-reason')).toBeInTheDocument();
    expect(screen.getByText('step-1')).toBeInTheDocument();
    expect(screen.getByText('24,538 → 70 (Σ 24,608)')).toBeInTheDocument();
    expect(screen.getByText('cache-hit-rate-low')).toBeInTheDocument();
  });

  it('collapses and expands nodes with children', async () => {
    render(() => <MonitorObservationTree observations={OBSERVATIONS} />);
    expect(screen.getByText('step-1')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Collapse agent-run' }));
    expect(screen.queryByText('step-1')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Expand agent-run' }));
    expect(screen.getByText('step-1')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    render(() => <MonitorObservationTree observations={[]} />);
    expect(screen.getByText('No observations for this trace.')).toBeInTheDocument();
  });

  it('opens detail on row click but not on chevron toggle', async () => {
    const onSelect = vi.fn();
    const observations: MonitorObservationView[] = [{
      id: 'agent-run',
      name: 'agent-run',
      kind: 'SPAN',
      level: 'DEFAULT',
      inputPreview: 'secret prompt',
      children: [{
        id: 'step-1',
        name: 'step-1',
        kind: 'GENERATION',
        level: 'DEFAULT',
        inputPreview: 'secret prompt',
      }],
    }];
    render(() => <MonitorObservationTree observations={observations} onSelect={onSelect} />);
    expect(screen.queryByText('secret prompt')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByTestId('monitor-observation-step-1'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'step-1' }));
    onSelect.mockClear();
    await fireEvent.click(screen.getByRole('button', { name: 'Collapse agent-run' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByText('step-1')).not.toBeInTheDocument();
  });
});
