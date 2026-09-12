import { describe, expect, it } from 'vitest';
import type { AgentActivityInfo, PeriTaskInfo } from '@/entities/chat/control-view';
import { selectAsyncStatusItems } from './async-status-items';

const runningActivity = {
  id: 'subagent:live-1',
  kind: 'subagent',
  status: 'running',
  label: 'Live reviewer',
  isBackground: true,
  metrics: { tool_count: 2 },
  attributes: {},
  createdAt: null,
  updatedAt: null,
} satisfies AgentActivityInfo;

const completedTask = {
  taskId: 'old-1',
  kind: 'subagent',
  taskSubtype: 'agent',
  title: 'Finished reviewer',
  summary: null,
  status: 'completed',
  isBackground: true,
  startedAt: null,
  completedAt: null,
  updatedAt: null,
} satisfies PeriTaskInfo;

describe('selectAsyncStatusItems', () => {
  it('falls back to async activities when Session Doc has no tasks', () => {
    const items = selectAsyncStatusItems([], [runningActivity]);
    expect(items).toEqual([expect.objectContaining({ id: 'subagent:live-1', label: 'Live reviewer', status: 'running' })]);
  });

  it('keeps live tasks and ignores a parallel activity with a different id', () => {
    const runningTask = { ...completedTask, taskId: 'task-1', title: 'Reviewer', status: 'running' as const };
    const items = selectAsyncStatusItems([runningTask], [runningActivity]);
    expect(items.map((item) => item.label)).toEqual(['Reviewer']);
  });

  it('unions an in-flight activity when remaining tasks are already terminal', () => {
    const items = selectAsyncStatusItems([completedTask], [runningActivity]);
    expect(items.map((item) => item.label)).toEqual(['Finished reviewer', 'Live reviewer']);
  });

  it('does not duplicate an in-flight activity whose correlation already has a task', () => {
    const items = selectAsyncStatusItems(
      [completedTask],
      [{ ...runningActivity, id: 'subagent:old-1' }],
    );
    expect(items.map((item) => item.id)).toEqual(['old-1']);
  });
});
