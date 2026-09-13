import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonitorObservationDetailShell } from './MonitorObservationDetailShell';
import type { MonitorObservationView } from './types';

const GENERATION: MonitorObservationView = {
  id: 'step-1',
  name: 'step-1',
  kind: 'GENERATION',
  latencyMs: 6850,
  level: 'DEFAULT',
  model: 'gpt-4',
  inputTokens: 24538,
  outputTokens: 70,
  inputPreview: '{"prompt":"hello"}',
  outputPreview: '{"text":"world"}',
};

const SCORE: MonitorObservationView = {
  id: 'cache-hit-rate-low',
  name: 'cache-hit-rate-low',
  kind: 'SCORE',
  level: 'DEFAULT',
  scoreValue: '0.42',
  scoreDataType: 'NUMERIC',
};

afterEach(() => cleanup());

describe('MonitorObservationDetailShell', () => {
  it('renders generation metadata and bounded IO', () => {
    render(() => <MonitorObservationDetailShell observation={GENERATION} />);
    expect(screen.getByText('step-1')).toBeInTheDocument();
    expect(screen.getByText('GENERATION')).toBeInTheDocument();
    expect(screen.getByText('gpt-4')).toBeInTheDocument();
    expect(screen.getByText('24,538 → 70 (Σ 24,608)')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-observation-input')).toHaveTextContent('{"prompt":"hello"}');
    expect(screen.getByTestId('monitor-observation-output')).toHaveTextContent('{"text":"world"}');
  });

  it('renders score value and data type', () => {
    render(() => <MonitorObservationDetailShell observation={SCORE} />);
    expect(screen.getByText('0.42')).toBeInTheDocument();
    expect(screen.getByText('NUMERIC')).toBeInTheDocument();
  });

  it('shows truncated label when preview was capped', () => {
    render(() => (
      <MonitorObservationDetailShell
        observation={{
          ...GENERATION,
          inputTruncated: true,
        }}
      />
    ));
    expect(screen.getByText('truncated')).toBeInTheDocument();
  });

  it('handles back navigation', async () => {
    const onBack = vi.fn();
    render(() => <MonitorObservationDetailShell observation={GENERATION} onBack={onBack} />);
    await fireEvent.click(screen.getByRole('button', { name: 'Back to observations' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
