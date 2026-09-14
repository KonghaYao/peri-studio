import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { MonitorTimelineDialogShell } from './MonitorTimelineDialogShell';
import { MonitorTimelineShell } from './MonitorTimelineShell';
import type { MonitorTimelineSegment } from './monitor-timeline-layout';

const SEGMENTS: MonitorTimelineSegment[] = [
  { id: 'gen-1', name: 'generation', kind: 'GENERATION', startMs: 0, endMs: 1200 },
];

afterEach(() => cleanup());

describe('MonitorTimelineDialogShell', () => {
  it('renders timeline and detail slots when open', () => {
    render(() => (
      <MonitorTimelineDialogShell
        open
        onOpenChange={() => {}}
        title="Observation timeline"
        description="Trace duration bands"
        timeline={<MonitorTimelineShell segments={SEGMENTS} width={640} />}
        detail={<p>Selected observation detail</p>}
        data-testid="monitor-timeline-dialog"
      />
    ));
    expect(screen.getByTestId('monitor-timeline-dialog')).toBeInTheDocument();
    expect(screen.getByText('Observation timeline')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-timeline-block-gen-1')).toBeInTheDocument();
    expect(screen.getByText('Selected observation detail')).toBeInTheDocument();
  });
});
