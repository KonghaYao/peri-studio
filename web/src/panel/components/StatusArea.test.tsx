import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../store', () => ({
  resourceWorkspace: () => ({
    repositories: [{ groups: { working_tree: { changes: [{ id: 'change-1', path: 'src/app.ts', status: 'modified' }] } } }],
  }),
}));

import { StatusArea } from './StatusArea';

afterEach(cleanup);

describe('StatusArea', () => {
  it('keeps todo, asynchronous work, and changed files in separate tabs', async () => {
    render(() => <StatusArea
      active
      plan={[{ id: 'todo-1', content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' }]}
      activities={[
        { id: 'task-1', kind: 'subagent', status: 'running', label: 'Reviewing UI', isBackground: true, metrics: { tool_count: 3 }, attributes: {}, createdAt: null, updatedAt: null },
        { id: 'task-2', kind: 'workflow', status: 'completed', label: 'Running checks', isBackground: true, metrics: {}, attributes: {}, createdAt: null, updatedAt: null },
      ]}
    />);

    expect(screen.getByRole('region', { name: 'Status area' })).toHaveTextContent('Running tests');
    expect(screen.getByRole('tabpanel')).not.toHaveTextContent('Reviewing UI');
    await fireEvent.click(screen.getByRole('tab', { name: /Async/ }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Reviewing UI');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Agent');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Workflow');
    await fireEvent.click(screen.getByRole('tab', { name: /Changes/ }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('src/app.ts');
  });

  it('keeps changed files visible after the turn ends', () => {
    render(() => <StatusArea active={false} plan={[{ id: 'todo-1', content: 'Done', status: 'completed', activeForm: null }]} activities={[]} />);
    expect(screen.getByRole('region', { name: 'Status area' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Changes/ })).toBeInTheDocument();
  });
});
