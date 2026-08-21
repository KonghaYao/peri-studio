import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentActivityInfo } from '../lib/control-view';
import { AgentActivityRail } from './AgentActivityRail';

afterEach(cleanup);

const activities: AgentActivityInfo[] = [
  { id: 'compact:one', kind: 'compact', status: 'completed', label: 'Context compacted', isBackground: null, metrics: { token_before: 8000, token_after: 2500 }, attributes: { strategy: 'smart' }, createdAt: '2026-08-15T00:00:00Z', updatedAt: '2026-08-15T00:00:01Z' },
  { id: 'subagent:two', kind: 'subagent', status: 'running', label: 'Code review', isBackground: true, metrics: { tool_count: 3 }, attributes: { task_kind: 'agent' }, createdAt: '2026-08-15T00:00:02Z', updatedAt: '2026-08-15T00:00:03Z' },
];

describe('AgentActivityRail', () => {
  it('is a quiet collapsed read-only disclosure led by the latest activity', () => {
    render(() => <AgentActivityRail activities={activities} />);
    const rail = screen.getByRole('group', { name: 'Peri activity' });
    expect(rail).not.toHaveAttribute('open');
    const summary = rail.querySelector('summary')!;
    expect(summary).toHaveTextContent('Code reviewRunning');
    expect(summary).not.toHaveTextContent('Activity');
    expect(summary.querySelector('.sr-only')).toHaveTextContent('Running');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    fireEvent.click(summary);
    expect(rail).toHaveAttribute('open');
    expect(rail).toHaveTextContent('Context compacted');
    expect(rail).toHaveTextContent('Before compaction');
    expect(rail).toHaveTextContent('8,000');
  });

  it('renders nothing without negotiated activity records', () => {
    const { container } = render(() => <AgentActivityRail activities={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not reserve space for completed activity history', () => {
    const { container } = render(() => <AgentActivityRail activities={[activities[0]]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
