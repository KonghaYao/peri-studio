import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEntry } from '../lib/chat-view';

import { StatusArea } from './StatusArea';

afterEach(cleanup);

const changedEntries = [{
  id: 'assistant-1', turnId: 'turn-1', kind: 'message', role: 'assistant', status: 'completed', authorUserId: null, sourceCommandId: null,
  createdAt: '', completedAt: null, text: '', blocks: [], reasoning: [], resources: [], error: null,
  toolCalls: [{ toolCallId: 'edit-1', name: 'Edit', kind: 'edit', status: 'completed', arguments: { file_path: 'src/app.ts' }, result: null, locations: [{ path: 'src/app.ts' }], resultOmitted: false, resultBytes: null, publicError: null, startedAt: null, completedAt: null }],
}] satisfies ChatEntry[];

describe('StatusArea', () => {
  it('keeps todo, asynchronous work, and changed files in separate tabs', async () => {
    render(() => <StatusArea
      active
      plan={[{ id: 'todo-1', content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' }]}
      activities={[
        { id: 'task-1', kind: 'subagent', status: 'running', label: 'Reviewing UI', isBackground: true, metrics: { tool_count: 3 }, attributes: {}, createdAt: null, updatedAt: null },
        { id: 'task-2', kind: 'workflow', status: 'completed', label: 'Running checks', isBackground: true, metrics: {}, attributes: {}, createdAt: null, updatedAt: null },
      ]}
      entries={changedEntries}
    />);

    expect(screen.getByRole('region', { name: 'Status area' })).toHaveTextContent('Running tests');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Running');
    expect(screen.getByRole('tabpanel')).not.toHaveTextContent('Reviewing UI');
    await fireEvent.click(screen.getByRole('tab', { name: /Async/ }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Reviewing UI');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Agent');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Workflow');
    await fireEvent.click(screen.getByRole('tab', { name: /Changes/ }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('src/app.ts');
    expect(screen.getByRole('tabpanel').querySelector('[data-file-icon="typescript"]')).toBeInTheDocument();
  });

  it('keeps changed files visible after the turn ends', () => {
    render(() => <StatusArea active={false} plan={[{ id: 'todo-1', content: 'Done', status: 'completed', activeForm: null }]} activities={[]} entries={changedEntries} />);
    expect(screen.getByRole('region', { name: 'Status area' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Changes/ })).toBeInTheDocument();
  });

  it('hides empty datasets and opens the first available status tab', () => {
    render(() => <StatusArea active plan={[]} activities={[]} entries={changedEntries} />);
    expect(screen.queryByRole('tab', { name: /Todo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Async/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Changes/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('src/app.ts');
  });

  it('keeps each todo state scannable without enlarging its row', () => {
    render(() => <StatusArea
      active
      plan={[
        { id: 'todo-1', content: 'Located boundary', status: 'completed', activeForm: null },
        { id: 'todo-2', content: 'Verify projection', status: 'pending', activeForm: null },
      ]}
      activities={[]}
      entries={[]}
    />);

    const rows = screen.getByRole('tabpanel').querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveClass('min-h-24');
    expect(rows[0]).toHaveTextContent('Done');
    expect(rows[1]).toHaveTextContent('Queued');
  });

  it('maps every asynchronous terminal and paused state without calling it queued', async () => {
    render(() => <StatusArea
      active
      plan={[]}
      activities={[
        { id: 'a1', kind: 'subagent', status: 'warning', label: 'Needs review', isBackground: true, metrics: {}, attributes: {}, createdAt: null, updatedAt: null },
        { id: 'a2', kind: 'workflow', status: 'suspended', label: 'Paused flow', isBackground: true, metrics: {}, attributes: {}, createdAt: null, updatedAt: null },
        { id: 'a3', kind: 'subagent', status: 'cancelled', label: 'Stopped agent', isBackground: true, metrics: {}, attributes: {}, createdAt: null, updatedAt: null },
        { id: 'a4', kind: 'background_task', status: 'info', label: 'Background note', isBackground: true, metrics: {}, attributes: {}, createdAt: null, updatedAt: null },
      ]}
      entries={[]}
    />);

    await fireEvent.click(screen.getByRole('tab', { name: /Async/ }));
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent('Warning');
    expect(panel).toHaveTextContent('Paused');
    expect(panel).toHaveTextContent('Cancelled');
    expect(panel).toHaveTextContent('Info');
    expect(panel).not.toHaveTextContent('Queued');
  });
});
