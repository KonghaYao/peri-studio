import * as Y from 'yjs';
import type { GitGroupId } from './resource-protocol';

export interface ResourceEntry { id: string; [key: string]: unknown }
export interface ResourceView {
  docId: string;
  viewId: string;
  projectId: string;
  viewType: 'fs_directory_page' | 'workspace_repositories_page' | 'git_repository' | 'git_group_page';
  path?: string;
  repoId?: string;
  groupId?: GitGroupId;
  sourceGeneration?: string;
  nextCursor?: string;
  entries: ResourceEntry[];
  meta: Record<string, unknown>;
}

const VIEW_TYPES: ResourceView['viewType'][] = [
  'fs_directory_page', 'workspace_repositories_page', 'git_repository', 'git_group_page',
];
const GIT_GROUP_IDS: GitGroupId[] = ['conflicts', 'index', 'working_tree', 'untracked'];

export function renderResourceView(docId: string, doc: Y.Doc): ResourceView | null {
  const root = doc.getMap('root');
  const meta = root.get('meta');
  const order = root.get('entry_order');
  const entries = root.get('entries');
  if (!(meta instanceof Y.Map) || !(order instanceof Y.Array) || !(entries instanceof Y.Map)) return null;
  const plainMeta = mapValue(meta);
  const viewType = plainMeta.view_id && plainMeta.view_type;
  if (typeof viewType !== 'string' || !VIEW_TYPES.includes(viewType as ResourceView['viewType'])
    || typeof plainMeta.view_id !== 'string'
    || typeof plainMeta.project_id !== 'string') return null;
  const groupId = stringValue(plainMeta.group_id);
  if (groupId !== undefined && !GIT_GROUP_IDS.includes(groupId as GitGroupId)) return null;
  const projected = order.toArray()
    .filter((id): id is string => typeof id === 'string')
    .map((id) => {
      const value = entries.get(id);
      return value instanceof Y.Map ? { id, ...mapValue(value) } : null;
    })
    .filter((entry): entry is ResourceEntry => !!entry);
  return {
    docId,
    viewId: plainMeta.view_id,
    projectId: plainMeta.project_id,
    viewType: viewType as ResourceView['viewType'],
    path: stringValue(plainMeta.path),
    repoId: stringValue(plainMeta.repo_id),
    groupId: groupId as GitGroupId | undefined,
    sourceGeneration: stringValue(plainMeta.source_generation),
    nextCursor: stringValue(plainMeta.next_cursor),
    entries: projected,
    meta: plainMeta,
  };
}

function mapValue(map: Y.Map<unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  map.forEach((value, key) => { result[key] = value instanceof Y.AbstractType ? value.toJSON() : value; });
  return result;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
