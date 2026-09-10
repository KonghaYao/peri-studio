import type { ToolCallInfo, ToolCallKind } from '@/entities/chat/chat-view';
import { formatWorkspacePathLabel, formatToolDisplayName } from '@/features/chat/tool-file-link';

export type ToolCardKind =
  | 'read-file'
  | 'read-directory'
  | 'write'
  | 'edit'
  | 'bash'
  | 'grep'
  | 'glob'
  | 'web-fetch'
  | 'web-search'
  | 'task'
  | 'todo'
  | 'skill'
  | 'question'
  | 'unknown';

export type NarrationStatus = 'running' | 'complete' | 'error' | 'canceled' | 'waiting_for_confirmation';

export type ToolNarration = {
  kind: ToolCardKind;
  title: string;
  subtitle?: string;
  filePreview?: { prefix: string; pathLabel: string; path: string };
  errorDetail?: string;
};

function argsRecord(args: unknown): Record<string, unknown> | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  return args as Record<string, unknown>;
}

export function truncateText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function formatElapsedBadge(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

function extractFileName(rawInput: unknown): string {
  const record = argsRecord(rawInput);
  const path = String(record?.file_path ?? record?.path ?? record?.filePath ?? '');
  if (!path) return 'file';
  return path.split('/').pop() || path;
}

function extractLineRange(rawInput: unknown): string {
  const record = argsRecord(rawInput);
  const offset = Number(record?.offset);
  const limit = Number(record?.limit);
  if (offset && limit) return `${offset}-${offset + limit - 1}`;
  const start = Number(record?.start_line);
  const end = Number(record?.end_line);
  if (start && end) return `${start}-${end}`;
  return '';
}

function compactDetailValue(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return value;
  const isPath = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.includes('/');
  if (!isPath) return truncateText(value, 40);
  return normalized.split('/').pop() || normalized;
}

function findFirstStringValue(rawInput: unknown): string | undefined {
  const record = argsRecord(rawInput);
  if (!record) return undefined;
  for (const value of Object.values(record)) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function normalizedName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function resolveToolCardKind(tool: Pick<ToolCallInfo, 'name' | 'kind' | 'arguments' | 'result'>): ToolCardKind {
  const record = argsRecord(tool.arguments);
  const norm = normalizedName(tool.name || '');

  if (norm.includes('folderoperations') || norm.includes('directory')) return 'read-directory';
  if (norm.includes('webfetch')) return 'web-fetch';
  if (norm.includes('websearch')) return 'web-search';
  if (norm.includes('grep')) return 'grep';
  if (norm.includes('glob')) return 'glob';
  if (norm.includes('askuser') || norm.includes('question')) return 'question';
  if (norm.includes('skill')) return 'skill';
  if (norm.includes('agent') || norm === 'task') return 'task';
  if (norm.includes('todo')) return 'todo';

  if (tool.kind === 'execute' || norm === 'bash' || norm === 'shell' || norm.includes('runterminal')) {
    if (record && (typeof record.command === 'string' || typeof record.cmd === 'string')) return 'bash';
  }
  if (tool.kind === 'read' || norm === 'read') return 'read-file';
  if (tool.kind === 'edit' || norm === 'edit' || norm === 'write' || norm === 'strreplace') {
    if (norm === 'write' || record && (
      typeof record.newText === 'string'
      || typeof record.content === 'string'
    )) return 'write';
    return 'edit';
  }
  if (tool.kind === 'delete' || tool.kind === 'move') return 'edit';

  if (!record) return 'unknown';

  if (typeof record.command === 'string' || typeof record.cmd === 'string' || typeof record.script === 'string') return 'bash';
  if (typeof record.url === 'string') return 'web-fetch';
  if (typeof record.pattern === 'string' && (typeof record.include === 'string' || typeof record.path === 'string')) return 'grep';
  if (typeof record.pattern === 'string') return 'glob';
  if (typeof record.query === 'string' || typeof record.search === 'string') return 'web-search';
  if (Array.isArray(record.todos) || Array.isArray(record.tasks)) return 'todo';
  if (typeof record.subagent_type === 'string' || typeof record.prompt === 'string') return 'task';
  if (typeof record.file_path === 'string' || typeof record.path === 'string' || typeof record.filePath === 'string') {
    if (typeof record.content === 'string') return 'write';
    if (typeof record.newText === 'string' || typeof record.new_string === 'string' || typeof record.oldText === 'string' || typeof record.old_string === 'string') return 'edit';
    return 'read-file';
  }

  return 'unknown';
}

export function supportsFilePreview(kind: ToolCardKind): boolean {
  return kind === 'read-file' || kind === 'edit' || kind === 'write';
}

function titlePhrase(verbDone: string, verbRunning: string, object: string, running: boolean): string {
  const verb = running ? verbRunning : verbDone;
  const trimmedObject = object.trim();
  if (!trimmedObject) return verb;
  return `${verb} ${trimmedObject}`;
}

function normalizeNarrationStatus(status: string, tone: string): NarrationStatus {
  const lower = status.toLowerCase();
  if (tone === 'running' || lower === 'running' || lower === 'in_progress') return 'running';
  if (tone === 'approval' || lower.includes('permission') || lower.includes('awaiting')) return 'waiting_for_confirmation';
  if (tone === 'failed' || lower === 'error' || lower === 'failed' || lower === 'denied') return 'error';
  if (lower === 'cancelled' || lower === 'canceled') return 'canceled';
  return 'complete';
}

function grepResultCount(result: unknown): number | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const record = result as Record<string, unknown>;
  if (typeof record.count === 'number') return record.count;
  if (Array.isArray(record.content)) {
    for (const item of record.content as Array<{ type?: string; text?: unknown }>) {
      if (item.type === 'text' && typeof item.text === 'string') {
        const match = item.text.match(/(\d+)\s*(?:matches|results|hits)/i);
        if (match) return Number(match[1]);
      }
    }
  }
  return undefined;
}

function editChangeCount(tool: ToolCallInfo): number | undefined {
  if (!Array.isArray(tool.content)) return undefined;
  const count = tool.content.filter(
    (item) => item && typeof item === 'object' && (item as { type?: string }).type === 'diff',
  ).length;
  return count > 0 ? count : undefined;
}

export function narrateToolCall(
  tool: ToolCallInfo,
  options: {
    tone: string;
    statusLabel: string;
    running: boolean;
    terminal: boolean;
    projectCwd?: string | null;
  },
): ToolNarration {
  const kind = resolveToolCardKind(tool);
  const record = argsRecord(tool.arguments);
  const narrationStatus = normalizeNarrationStatus(tool.status || '', options.tone);
  const running = options.running || narrationStatus === 'running';

  const errorDetail = narrationStatus === 'error'
    ? [tool.publicError?.code, tool.publicError?.message].filter(Boolean).join(': ') || undefined
    : undefined;

  const pathFromArgs = [record?.file_path, record?.path, record?.filePath].find((item) => typeof item === 'string') as string | undefined;

  let title = '';
  let subtitle: string | undefined;
  let filePreview: ToolNarration['filePreview'];

  switch (kind) {
    case 'bash': {
      const cmd = String(record?.command ?? record?.cmd ?? '');
      const object = `$ ${truncateText(cmd, 120)}`;
      title = titlePhrase('Ran', 'Running', object, running);
      break;
    }
    case 'read-file':
    case 'read-directory': {
      const file = extractFileName(tool.arguments);
      const verbDone = kind === 'read-directory' ? 'Listed' : 'Opened';
      const verbRunning = kind === 'read-directory' ? 'Listing' : 'Opening';
      title = titlePhrase(verbDone, verbRunning, file, running);
      const range = extractLineRange(tool.arguments);
      if (range) subtitle = `Lines ${range}`;
      break;
    }
    case 'write': {
      const file = extractFileName(tool.arguments);
      title = titlePhrase('Wrote', 'Writing', file, running);
      break;
    }
    case 'edit': {
      const file = extractFileName(tool.arguments);
      title = titlePhrase('Edited', 'Editing', file, running);
      if (narrationStatus === 'complete') {
        const count = editChangeCount(tool);
        if (count) subtitle = `${count} change${count === 1 ? '' : 's'}`;
      }
      break;
    }
    case 'grep': {
      const pattern = String(record?.pattern ?? '');
      const quoted = `"${truncateText(pattern, 40)}"`;
      title = titlePhrase('Searched', 'Searching', quoted, running);
      const parts: string[] = [];
      const path = String(record?.path ?? record?.include ?? '');
      if (path) parts.push(`in ${compactDetailValue(path)}`);
      if (narrationStatus === 'complete') {
        const count = grepResultCount(tool.result);
        if (count !== undefined) parts.push(`${count} match${count === 1 ? '' : 'es'}`);
      }
      if (parts.length) subtitle = parts.join(' · ');
      break;
    }
    case 'glob': {
      const pattern = String(record?.pattern ?? '');
      const quoted = `"${truncateText(pattern, 40)}"`;
      title = titlePhrase('Matched', 'Matching', quoted, running);
      break;
    }
    case 'web-fetch': {
      const url = String(record?.url ?? '');
      title = titlePhrase('Fetched', 'Fetching', truncateText(url, 80), running);
      break;
    }
    case 'web-search': {
      const query = String(record?.query ?? record?.search ?? '');
      title = titlePhrase('Searched', 'Searching', truncateText(query, 80), running);
      break;
    }
    case 'task': {
      const label = formatToolDisplayName(tool.name || 'Task');
      title = titlePhrase('Started', 'Starting', label, running);
      break;
    }
    case 'todo': {
      title = titlePhrase('Updated', 'Updating', 'todos', running);
      break;
    }
    case 'skill': {
      const label = formatToolDisplayName(tool.name || 'Skill');
      title = titlePhrase('Used', 'Using', label, running);
      break;
    }
    case 'question': {
      title = titlePhrase('Asked', 'Asking', 'question', running);
      break;
    }
    default: {
      const name = formatToolDisplayName(tool.name || 'tool');
      title = titlePhrase('Used', 'Using', name, running);
      const first = findFirstStringValue(tool.arguments);
      if (first) subtitle = compactDetailValue(first);
    }
  }

  if (pathFromArgs && supportsFilePreview(kind) && narrationStatus !== 'waiting_for_confirmation' && !errorDetail) {
    const verbRunning = kind === 'write' ? 'Writing' : kind === 'edit' ? 'Editing' : 'Opening';
    const verbDone = kind === 'write' ? 'Wrote' : kind === 'edit' ? 'Edited' : 'Opened';
    filePreview = {
      prefix: running ? `${verbRunning} ` : `${verbDone} `,
      pathLabel: formatWorkspacePathLabel(pathFromArgs, options.projectCwd),
      path: pathFromArgs,
    };
    const range = extractLineRange(tool.arguments);
    if (range && !subtitle) subtitle = `Lines ${range}`;
    return { kind, title: '', subtitle, filePreview, errorDetail };
  }

  if (errorDetail && !title) {
    title = formatToolDisplayName(tool.name || 'Tool');
  }

  return { kind, title, subtitle, filePreview, errorDetail };
}

export function mapToolCallKindToCardKind(kind: ToolCallKind | null | undefined): ToolCardKind | null {
  if (kind === 'execute') return 'bash';
  if (kind === 'read') return 'read-file';
  if (kind === 'edit') return 'edit';
  if (kind === 'delete' || kind === 'move') return 'edit';
  return null;
}
