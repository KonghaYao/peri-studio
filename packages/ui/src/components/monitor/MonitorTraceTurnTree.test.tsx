import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonitorTraceTurnTree } from './MonitorTraceTurnTree';
import type { MonitorTraceObservationFlat } from './build-trace-turn-tree';

const base = (overrides: Partial<MonitorTraceObservationFlat> & Pick<MonitorTraceObservationFlat, 'id'>): MonitorTraceObservationFlat => ({
  parentId: null,
  type: 'SPAN',
  name: overrides.id,
  startTime: '2025-01-01T00:00:00.000Z',
  endTime: '2025-01-01T00:00:01.000Z',
  level: 'DEFAULT',
  ...overrides,
});

const OBSERVATIONS: MonitorTraceObservationFlat[] = [
  base({ id: 'agent-run', name: 'agent-run', startTime: '2025-01-01T00:00:00.000Z' }),
  base({
    id: 'stage-reason',
    parentId: 'agent-run',
    name: 'stage-reason',
    startTime: '2025-01-01T00:00:01.000Z',
  }),
  base({
    id: 'plan',
    parentId: 'stage-reason',
    type: 'GENERATION',
    name: 'plan-step',
    startTime: '2025-01-01T00:00:02.000Z',
    endTime: '2025-01-01T00:00:08.850Z',
    inputTokens: 1200,
    outputTokens: 48,
  }),
  base({
    id: 'read-file',
    parentId: 'agent-run',
    type: 'TOOL',
    name: 'read_file',
    startTime: '2025-01-01T00:00:09.000Z',
    endTime: '2025-01-01T00:00:09.420Z',
    output: '{"bytes":2048}',
  }),
];

afterEach(() => cleanup());

describe('MonitorTraceTurnTree', () => {
  it('builds tree from flat observations and hoists stage-* noise by default', () => {
    render(() => <MonitorTraceTurnTree observations={OBSERVATIONS} />);
    expect(screen.getByText('agent-run')).toBeInTheDocument();
    expect(screen.getByText('plan-step')).toBeInTheDocument();
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.queryByText('stage-reason')).not.toBeInTheDocument();
    expect(screen.getByText('6.85 s')).toBeInTheDocument();
    expect(screen.getByText(/~4 tokens/)).toBeInTheDocument();
  });

  it('selects nodes and trace root independently', async () => {
    const onSelect = vi.fn();
    const onTraceRootSelect = vi.fn();
    render(() => (
      <MonitorTraceTurnTree
        observations={OBSERVATIONS}
        traceRoot={{ name: 'demo-trace', latencyMs: 9400 }}
        selectedTraceRoot
        onSelect={onSelect}
        onTraceRootSelect={onTraceRootSelect}
      />
    ));
    await fireEvent.click(screen.getByTestId('monitor-trace-turn-node-plan'));
    expect(onSelect).toHaveBeenCalledWith('plan');
    await fireEvent.click(screen.getByTestId('monitor-trace-turn-tree-root'));
    expect(onTraceRootSelect).toHaveBeenCalled();
  });

  it('collapses children without selecting parent', async () => {
    const onSelect = vi.fn();
    render(() => (
      <MonitorTraceTurnTree observations={OBSERVATIONS} onSelect={onSelect} />
    ));
    await fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(screen.queryByText('plan-step')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders turn sections when turns prop is provided', () => {
    render(() => (
      <MonitorTraceTurnTree
        turns={[
          { id: 'turn-1', label: 'Turn 1', observations: [OBSERVATIONS[0], OBSERVATIONS[1], OBSERVATIONS[2]] },
          { id: 'turn-2', label: 'Turn 2', observations: [OBSERVATIONS[3]] },
        ]}
        omitNoise={false}
      />
    ));
    expect(screen.getByText('Turn 1')).toBeInTheDocument();
    expect(screen.getByText('Turn 2')).toBeInTheDocument();
    expect(screen.getByText('read_file')).toBeInTheDocument();
  });
});
