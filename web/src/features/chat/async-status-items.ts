import type { AgentActivityInfo, PeriTaskInfo, PeriTaskSubtype } from '@/entities/chat/control-view';

const ASYNC_ACTIVITY_KINDS = new Set(['subagent', 'background_task', 'workflow']);
const TASK_SUBTYPES = new Set<PeriTaskSubtype>(['agent', 'shell', 'workflow']);

export type AsyncBadgeKind = PeriTaskSubtype;

export interface AsyncStatusItem {
  id: string;
  kind: string;
  status: string;
  label: string;
  badgeKind: AsyncBadgeKind;
  toolCount: number | null;
}

export function asyncBadgeLabel(kind: AsyncBadgeKind): string {
  if (kind === 'agent') return 'Agent';
  if (kind === 'shell') return 'Shell';
  return 'Workflow';
}

function isTaskSubtype(value: string | undefined): value is PeriTaskSubtype {
  return !!value && TASK_SUBTYPES.has(value as PeriTaskSubtype);
}

function badgeFromTask(task: PeriTaskInfo): AsyncBadgeKind {
  if (task.taskSubtype) return task.taskSubtype;
  return task.kind === 'subagent' ? 'agent' : 'shell';
}

function badgeFromActivity(activity: AgentActivityInfo): AsyncBadgeKind {
  if (isTaskSubtype(activity.attributes.task_kind)) return activity.attributes.task_kind;
  if (activity.kind === 'subagent') return 'agent';
  if (activity.kind === 'workflow') return 'workflow';
  return 'shell';
}

function isInFlight(status: string) {
  return status === 'in_progress' || status === 'running';
}

function activityCorrelation(id: string): string | null {
  const idx = id.indexOf(':');
  return idx >= 0 ? id.slice(idx + 1) : null;
}

function fromTask(task: PeriTaskInfo): AsyncStatusItem {
  return {
    id: task.taskId,
    kind: task.kind,
    status: task.status,
    label: task.title || task.summary || 'Background task',
    badgeKind: badgeFromTask(task),
    toolCount: null,
  };
}

function fromActivity(activity: AgentActivityInfo): AsyncStatusItem {
  return {
    id: activity.id,
    kind: activity.kind,
    status: activity.status,
    label: activity.label || 'Background task',
    badgeKind: badgeFromActivity(activity),
    toolCount: Number.isFinite(activity.metrics.tool_count) ? activity.metrics.tool_count : null,
  };
}

function coveredByTask(activity: AsyncStatusItem, taskIds: Set<string>) {
  if (taskIds.has(activity.id)) return true;
  const correlation = activityCorrelation(activity.id);
  return correlation !== null && taskIds.has(correlation);
}

/** Session Doc tasks 优先；全部终态时并入未覆盖的 in-flight activity，避免藏起仍在跑的子 agent。 */
export function selectAsyncStatusItems(
  tasks: PeriTaskInfo[],
  activities: AgentActivityInfo[],
): AsyncStatusItem[] {
  const fromTasks = tasks.map(fromTask);
  const fromActivities = activities
    .filter((activity) => ASYNC_ACTIVITY_KINDS.has(activity.kind))
    .map(fromActivity);
  if (fromTasks.length === 0) return fromActivities;
  if (fromTasks.some((item) => isInFlight(item.status))) return fromTasks;
  const taskIds = new Set(fromTasks.map((item) => item.id));
  const uncoveredInFlight = fromActivities.filter((item) => isInFlight(item.status) && !coveredByTask(item, taskIds));
  return uncoveredInFlight.length === 0 ? fromTasks : [...fromTasks, ...uncoveredInFlight];
}
