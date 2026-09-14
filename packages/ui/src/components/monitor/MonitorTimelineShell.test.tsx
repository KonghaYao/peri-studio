import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonitorTimelineShell } from './MonitorTimelineShell';
import type { MonitorTimelineSegment } from './monitor-timeline-layout';

const SEGMENTS: MonitorTimelineSegment[] = [
  { id: 'gen-1', name: 'generation', kind: 'GENERATION', startMs: 0, endMs: 1200, tokens: 120 },
  { id: 'tool-1', name: 'read_file', kind: 'TOOL', startMs: 300, endMs: 900 },
];

const HEATMAP_SEGMENTS: MonitorTimelineSegment[] = [
  { id: 'short', name: 'cache', kind: 'TOOL', startMs: 0, endMs: 40 },
  { id: 'mid', name: 'read', kind: 'TOOL', startMs: 100, endMs: 600 },
  { id: 'long', name: 'embed', kind: 'TOOL', startMs: 200, endMs: 4800 },
];

afterEach(() => cleanup());

describe('MonitorTimelineShell', () => {
  it('renders timeline blocks', () => {
    render(() => <MonitorTimelineShell segments={SEGMENTS} width={640} />);
    expect(screen.getByTestId('monitor-timeline-shell')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-timeline-block-gen-1')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    render(() => <MonitorTimelineShell segments={[]} width={640} />);
    expect(screen.getByText('No timeline data')).toBeInTheDocument();
  });

  it('applies selection ring to the selected block', () => {
    render(() => (
      <MonitorTimelineShell segments={SEGMENTS} width={640} selectedId="gen-1" />
    ));
    expect(screen.getByTestId('monitor-timeline-block-gen-1')).toHaveClass(
      'ring-2',
      'ring-accent-solid',
    );
    expect(screen.getByTestId('monitor-timeline-block-tool-1')).not.toHaveClass('ring-accent-solid');
  });

  it('notifies onSelect when a block is clicked', async () => {
    const onSelect = vi.fn();
    render(() => (
      <MonitorTimelineShell segments={SEGMENTS} width={640} onSelect={onSelect} />
    ));
    await fireEvent.click(screen.getByTestId('monitor-timeline-block-tool-1'));
    expect(onSelect).toHaveBeenCalledWith('tool-1');
  });

  it('applies heatmap opacity when heatmap is enabled', () => {
    render(() => (
      <MonitorTimelineShell segments={HEATMAP_SEGMENTS} width={640} heatmap />
    ));
    const short = screen.getByTestId('monitor-timeline-block-short');
    const long = screen.getByTestId('monitor-timeline-block-long');
    expect(short.style.opacity).not.toBe('');
    expect(long.style.opacity).not.toBe('');
    expect(Number(short.style.opacity)).toBeLessThan(Number(long.style.opacity));
  });

  it('does not apply heatmap opacity when heatmap is off', () => {
    render(() => (
      <MonitorTimelineShell segments={HEATMAP_SEGMENTS} width={640} />
    ));
    expect(screen.getByTestId('monitor-timeline-block-short').style.opacity).toBe('');
  });

  it('marks running segments with the running stripe class', () => {
    render(() => (
      <MonitorTimelineShell
        segments={[
          { id: 'anchor', name: 'agent', kind: 'AGENT', startMs: 0, endMs: 2000 },
          {
            id: 'run',
            name: 'streaming',
            kind: 'GENERATION',
            startMs: 400,
            endMs: 400,
            running: true,
          },
        ]}
        width={640}
      />
    ));
    expect(screen.getByTestId('monitor-timeline-block-run')).toHaveClass('ui-monitor-timeline-running');
  });
});
