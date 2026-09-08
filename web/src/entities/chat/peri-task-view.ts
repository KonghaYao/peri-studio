import type * as Y from 'yjs';
import { asArray, asMap, getStr } from '@/shared/yjs/yjs-values';

export type PeriTaskKind = 'subagent' | 'background';
export type PeriTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type PeriTaskSubtype = 'agent' | 'shell' | 'workflow';

export interface PeriTaskInfo {
  taskId: string;
  kind: PeriTaskKind;
  taskSubtype: PeriTaskSubtype | null;
  title: string;
  summary: string | null;
  status: PeriTaskStatus;
  isBackground: boolean;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
}

const TASK_KINDS = new Set<PeriTaskKind>(['subagent', 'background']);
const TASK_STATUSES = new Set<PeriTaskStatus>(['running', 'completed', 'failed', 'cancelled']);
const TASK_SUBTYPES = new Set<PeriTaskSubtype>(['agent', 'shell', 'workflow']);

/** 只读投影 Session Doc `tasks` / `task_order`；未知 kind/status 丢弃。 */
export function readPeriTasks(root: Y.Map<unknown>): PeriTaskInfo[] {
  const tasks = asMap(root.get('tasks'));
  if (!tasks) return [];
  const order = (asArray(root.get('task_order'))?.toArray() ?? [])
    .filter((value): value is string => typeof value === 'string');
  const seen = new Set<string>();
  const result: PeriTaskInfo[] = [];
  for (const taskId of order) {
    if (seen.has(taskId)) continue;
    seen.add(taskId);
    const item = asMap(tasks.get(taskId));
    const kind = getStr(item, 'kind');
    const status = getStr(item, 'status');
    const title = getStr(item, 'title');
    if (!item || !kind || !TASK_KINDS.has(kind as PeriTaskKind) || !status || !TASK_STATUSES.has(status as PeriTaskStatus) || !title) continue;
    const subtype = getStr(item, 'task_subtype');
    result.push({
      taskId,
      kind: kind as PeriTaskKind,
      taskSubtype: subtype && TASK_SUBTYPES.has(subtype as PeriTaskSubtype) ? subtype as PeriTaskSubtype : null,
      title,
      summary: getStr(item, 'summary'),
      status: status as PeriTaskStatus,
      isBackground: item.get('is_background') === true,
      startedAt: getStr(item, 'started_at'),
      completedAt: getStr(item, 'completed_at'),
      updatedAt: getStr(item, 'updated_at'),
    });
  }
  return result;
}
