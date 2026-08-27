import type { ChatEntry, ToolCallInfo } from './chat-view';

export interface ChatFileChange {
  path: string;
  operation: 'edited' | 'written';
}

const PATH_KEYS = ['file_path', 'filePath', 'path', 'uri', 'filename'] as const;
const MAX_PATH_LENGTH = 4096;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function displayPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  return path && path.length <= MAX_PATH_LENGTH ? path : null;
}

function directPath(value: unknown): string | null {
  const source = record(value);
  if (!source) return displayPath(value);
  for (const key of PATH_KEYS) {
    const path = displayPath(source[key]);
    if (path) return path;
  }
  return null;
}

function pathsFromList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(directPath).filter((path): path is string => path !== null);
}

function resultPaths(result: unknown): string[] {
  const source = record(result);
  if (!source) return [];
  for (const key of ['locations', 'files', 'changed_files', 'changedFiles']) {
    const paths = pathsFromList(source[key]);
    if (paths.length) return paths;
  }
  const path = directPath(source);
  return path ? [path] : [];
}

function operationFromTool(tool: ToolCallInfo): ChatFileChange['operation'] {
  const source = record(tool.result);
  const operation = typeof source?.operation === 'string' ? source.operation.toLowerCase() : '';
  const name = (tool.name ?? '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  return source?.created === true
    || source?.written === true
    || ['add', 'create', 'write', 'written'].includes(operation)
    || ['write', 'write_file', 'create', 'create_file'].includes(name)
    ? 'written'
    : 'edited';
}

function toolChanges(tool: ToolCallInfo): ChatFileChange[] {
  if (tool.kind !== 'edit' || !['completed', 'complete', 'done'].includes((tool.status ?? '').toLowerCase()) || tool.publicError) return [];
  const operation = operationFromTool(tool);
  const projectedPaths = pathsFromList(tool.locations);
  if (projectedPaths.length) return projectedPaths.map((path) => ({ path, operation }));
  const paths = resultPaths(tool.result);
  const fallback = directPath(tool.arguments);
  return (paths.length ? paths : fallback ? [fallback] : []).map((path) => ({ path, operation }));
}

export function selectChatFileChanges(entries: readonly ChatEntry[]): ChatFileChange[] {
  const changes = new Map<string, ChatFileChange>();
  for (const entry of entries) {
    for (const tool of entry.toolCalls) {
      for (const change of toolChanges(tool)) {
        if (!changes.has(change.path)) changes.set(change.path, change);
      }
    }
  }
  return [...changes.values()];
}
