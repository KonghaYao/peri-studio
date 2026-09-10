import type { ToolCallKind } from '@/entities/chat/chat-view';

const FILE_PATH_KEYS = ['file_path', 'filePath', 'path'] as const;

/** 将工具参数中的路径规范为项目内相对路径（供 resource API 使用）。 */
export function normalizeWorkspaceRelativePath(raw: string, projectCwd?: string | null): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cwd = projectCwd?.replace(/\/$/, '') ?? '';
  if (cwd && (trimmed === cwd || trimmed.startsWith(`${cwd}/`))) {
    const relative = trimmed.slice(cwd.length).replace(/^\//, '');
    return relative || '.';
  }
  return trimmed.replace(/^\//, '');
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

/** 工作区路径展示：项目 cwd 内显示完整相对路径；根外绝对路径不伪装成相对路径。 */
export function formatWorkspacePathLabel(raw: string, projectCwd?: string | null): string {
  const trimmed = normalizeSlashes(raw.trim());
  if (!trimmed) return trimmed;
  const cwd = normalizeSlashes(projectCwd?.trim() ?? '').replace(/\/$/, '');
  if (cwd && (trimmed === cwd || trimmed.startsWith(`${cwd}/`))) {
    return trimmed.slice(cwd.length).replace(/^\//, '') || '.';
  }
  if (!trimmed.startsWith('/') && !/^[A-Za-z]:\//.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
}

function argumentRecord(args: unknown): Record<string, unknown> | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  return args as Record<string, unknown>;
}

export function compactToolInput(value: unknown): string {
  const record = argumentRecord(value);
  if (!record) return typeof value === 'string' ? value : '';
  const preferred = [...FILE_PATH_KEYS, 'command', 'cmd', 'query', 'pattern', 'uri', 'url', 'file']
    .map((key) => record[key])
    .find((item) => typeof item === 'string');
  if (typeof preferred === 'string') return preferred;
  const first = Object.values(record).find((item) => typeof item === 'string' || typeof item === 'number');
  return first === undefined ? '' : String(first);
}

function normalizedToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** 可从工具行点击打开 Explorer + 预览的文件路径（原始参数，未相对化）。 */
export function extractLinkableFilePath(
  name: string,
  kind: ToolCallKind | null | undefined,
  args: unknown,
): string | null {
  const record = argumentRecord(args);
  if (!record) return null;
  const raw = FILE_PATH_KEYS.map((key) => record[key]).find((item) => typeof item === 'string' && item.trim());
  if (typeof raw !== 'string') return null;

  if (kind === 'read' || kind === 'edit' || kind === 'delete' || kind === 'move') return raw;

  const norm = normalizedToolName(name);
  if (norm === 'read' || norm === 'write' || norm === 'edit' || norm === 'grep') return raw;
  if (norm.includes('read') && FILE_PATH_KEYS.some((key) => typeof record[key] === 'string')) return raw;
  return null;
}

export function formatToolDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Tool';
  const short = trimmed.split(/[/:]/).pop() ?? trimmed;
  if (short.length <= 24) return short;
  return short;
}

export function formatToolPathLabel(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 3) return normalized;
  return `…/${parts.slice(-2).join('/')}`;
}
