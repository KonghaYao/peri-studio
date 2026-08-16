import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentPlanPanel } from './AgentPlanPanel';

afterEach(cleanup);

describe('AgentPlanPanel', () => {
  it('summarizes progress and prefers negotiated active wording for current work', () => {
    render(() => <AgentPlanPanel entries={[
      { id: '0', content: 'Inspect code', status: 'completed', activeForm: null },
      { id: '1', content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' },
      { id: '2', content: 'Ship change', status: 'pending', activeForm: null },
    ]} />);
    const panel = screen.getByRole('group', { name: 'Agent execution plan' });
    expect(panel).not.toHaveAttribute('open');
    expect(panel).toHaveTextContent('Running tests');
    expect(panel).toHaveTextContent('1/3');
    fireEvent.click(panel.querySelector('summary')!);
    expect(panel).toHaveAttribute('open');
    expect(panel).toHaveTextContent('Run tests');
    expect(panel).toHaveTextContent('In progress');
  });

  it('renders nothing for an absent plan', () => {
    const { container } = render(() => <AgentPlanPanel entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
