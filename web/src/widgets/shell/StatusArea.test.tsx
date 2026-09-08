import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEntry } from '@/entities/chat/chat-view';

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

  it('prefers Session Doc tasks over activity fallback for the async tab', async () => {
    render(() => <StatusArea
      active
      plan={[]}
      activities={[
        { id: 'legacy', kind: 'subagent', status: 'running', label: 'Legacy activity', isBackground: true, metrics: { tool_count: 2 }, attributes: {}, createdAt: null, updatedAt: null },
      ]}
      tasks={[
        { taskId: 'task-1', kind: 'subagent', taskSubtype: 'agent', title: 'Reviewer', summary: null, status: 'running', isBackground: true, startedAt: null, completedAt: null, updatedAt: null },
        { taskId: 'task-2', kind: 'background', taskSubtype: 'shell', title: 'Compile', summary: null, status: 'completed', isBackground: true, startedAt: null, completedAt: null, updatedAt: null },
      ]}
      entries={[]}
    />);

    await fireEvent.click(screen.getByRole('tab', { name: /Async/ }));
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent('Reviewer');
    expect(panel).toHaveTextContent('Compile');
    expect(panel).toHaveTextContent('Agent');
    expect(panel).toHaveTextContent('Workflow');
    expect(panel).not.toHaveTextContent('Legacy activity');
  });

  it('shows the async tab with a running label when the turn is inactive but a task is still running', async () => {
    render(() => <StatusArea
      active={false}
      plan={[]}
      activities={[]}
      tasks={[
        { taskId: 'task-run', kind: 'subagent', taskSubtype: 'agent', title: 'Background reviewer', summary: null, status: 'running', isBackground: true, startedAt: null, completedAt: null, updatedAt: null },
      ]}
      entries={[]}
    />);

    expect(screen.getByRole('tab', { name: /Async/ })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Background reviewer');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Running');
  });

  it('collapses and expands the status panel from the header control', async () => {
    render(() => <StatusArea
      active
      plan={[]}
      activities={[
        { id: 'task-1', kind: 'subagent', status: 'running', label: 'Reviewing UI', isBackground: true, metrics: { tool_count: 3 }, attributes: {}, createdAt: null, updatedAt: null },
      ]}
      entries={changedEntries}
    />);

    expect(screen.getByRole('tabpanel')).toHaveTextContent('Reviewing UI');
    await fireEvent.click(screen.getByRole('button', { name: 'Collapse status panel' }));
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Expand status panel' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Reviewing UI');
  });

  it('hides the async tab when the turn is inactive and only terminal tasks remain', () => {
    render(() => <StatusArea
      active={false}
      plan={[]}
      activities={[]}
      tasks={[
        { taskId: 'task-done', kind: 'subagent', taskSubtype: 'agent', title: 'Finished reviewer', summary: null, status: 'completed', isBackground: true, startedAt: null, completedAt: null, updatedAt: null },
      ]}
      entries={[]}
    />);

    expect(screen.queryByRole('region', { name: 'Status area' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Async/ })).not.toBeInTheDocument();
  });
});
