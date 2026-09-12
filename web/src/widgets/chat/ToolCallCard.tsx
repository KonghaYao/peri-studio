import {
  FilePen,
  FilePlus,
  FileText,
  FolderSearch,
  Globe,
  HelpCircle,
  ListTodo,
  Search,
  Sparkles,
  Terminal,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-solid';
import { createMemo, createSignal, type Accessor } from 'solid-js';
import type { ToolCallInfo, ToolCallKind } from '@/entities/chat/chat-view';
import {
  formatElapsedBadge,
  narrateToolCall,
  type ToolCardKind,
  type ToolNarration,
} from '@/features/chat/tool-narration';
import { openWorkspaceFromTool } from '@/store';
import {
  ToolActivityGroup as UiToolActivityGroup,
  ToolActivityRow,
  type ToolActivityEvidence,
  type ToolCallStatus,
} from '@peri/ui';

export type { ToolCallStatus };

const TOOL_ICONS: Record<ToolCardKind, LucideIcon> = {
  'read-file': FileText,
  'read-directory': FolderSearch,
  write: FilePlus,
  edit: FilePen,
  bash: Terminal,
  grep: Search,
  glob: FolderSearch,
  'web-fetch': Globe,
  'web-search': Search,
  task: Workflow,
  todo: ListTodo,
  skill: Sparkles,
  question: HelpCircle,
  unknown: Wrench,
};

const STATUS: Record<string, { label: string; tone: ToolCallStatus }> = {
  pending: { label: 'Queued', tone: 'queued' },
  awaitingpermission: { label: 'Approval', tone: 'approval' },
  awaiting_permission: { label: 'Approval', tone: 'approval' },
  permission_required: { label: 'Approval', tone: 'approval' },
  running: { label: 'Running', tone: 'running' },
  in_progress: { label: 'Running', tone: 'running' },
  completed: { label: 'Done', tone: 'done' },
  complete: { label: 'Done', tone: 'done' },
  error: { label: 'Failed', tone: 'failed' },
  failed: { label: 'Failed', tone: 'failed' },
  denied: { label: 'Denied', tone: 'failed' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function readableToolValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function observedDurationMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const elapsed = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  return elapsed;
}

export function observedDuration(startedAt: string | null, completedAt: string | null): string | null {
  const elapsed = observedDurationMs(startedAt, completedAt);
  if (elapsed === null) return null;
  return formatElapsedBadge(elapsed);
}

export function readableBytes(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function toolFamily(kind: ToolCallKind | null | undefined): 'shell' | 'read' | 'write' | 'generic' {
  if (kind === 'execute') return 'shell';
  if (kind === 'read') return 'read';
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return 'write';
  return 'generic';
}

function toolEvidence(kind: ToolCallKind | null | undefined, input: unknown, output: unknown) {
  const family = toolFamily(kind);
  if (family === 'shell') return { inputLabel: 'Command', input, outputLabel: 'Output', output };
  if (family === 'read') return { inputLabel: 'File', input, outputLabel: 'Content', output };
  if (family === 'write') return { inputLabel: 'Change', input, outputLabel: 'Result', output };
  return { inputLabel: 'Input', input, outputLabel: 'Output', output };
}

function buildEvidence(props: {
  tool: ToolCallInfo;
  evidence: ReturnType<typeof toolEvidence>;
  errorText: string;
  showEmptyOutput: boolean;
  showLegacyOutput: boolean;
}): ToolActivityEvidence[] {
  const items: ToolActivityEvidence[] = [];
  const { tool, evidence, errorText } = props;

  if (tool.arguments !== undefined && tool.arguments !== null) {
    items.push({ kind: 'value', label: evidence.inputLabel, value: readableToolValue(tool.arguments) });
  }
  if (tool.argumentsOmitted) {
    items.push({
      kind: 'omitted',
      label: 'Input not loaded',
      sizeLabel: readableBytes(tool.argumentsBytes ?? null),
      noun: 'input',
    });
  }

  if (tool.result !== undefined && tool.result !== null) {
    items.push({ kind: 'value', label: evidence.outputLabel, value: readableToolValue(tool.result) });
  }
  if (tool.resultOmitted) {
    items.push({
      kind: 'omitted',
      label: 'Output not loaded',
      sizeLabel: readableBytes(tool.resultBytes ?? null),
      noun: 'result',
    });
  }

  if (tool.content !== undefined && tool.content !== null) {
    items.push({ kind: 'value', label: 'Tool content', value: readableToolValue(tool.content) });
  }
  if (tool.contentOmitted) {
    items.push({
      kind: 'omitted',
      label: 'Tool content not loaded',
      sizeLabel: readableBytes(tool.contentBytes ?? null),
      noun: 'tool content',
    });
  }

  if (tool.locations !== undefined && tool.locations !== null) {
    items.push({ kind: 'value', label: 'Locations', value: readableToolValue(tool.locations) });
  }
  if (tool.locationsOmitted) {
    items.push({
      kind: 'omitted',
      label: 'Locations not loaded',
      sizeLabel: readableBytes(tool.locationsBytes ?? null),
      noun: 'location evidence',
    });
  }

  if (errorText) {
    items.push({ kind: 'value', label: 'Error', value: errorText, tone: 'error' });
  }

  if (props.showEmptyOutput) {
    items.push({ kind: 'message', text: 'The tool returned no displayable output.' });
  }
  if (props.showLegacyOutput) {
    items.push({
      kind: 'message',
      text: 'This history record has no output; the legacy projection did not record whether it was empty or omitted due to size limits.',
      italic: true,
    });
  }

  return items;
}

function mapNarrationToRowProps(
  narration: ToolNarration,
  options: {
    status: ToolCallStatus;
    statusLabel: string;
    durationBadge: string | null;
    toolCallId?: string;
    variant?: 'default' | 'activity';
    evidence: ToolActivityEvidence[];
    evidenceLoaded: boolean;
    onOpenEvidence: () => void;
  },
) {
  const preview = narration.filePreview;
  return {
    icon: TOOL_ICONS[narration.kind],
    toolKind: narration.kind,
    title: narration.title,
    subtitle: narration.subtitle,
    errorDetail: narration.errorDetail,
    status: options.status,
    statusLabel: options.statusLabel,
    duration: options.durationBadge ?? undefined,
    variant: options.variant,
    toolCallId: options.toolCallId,
    filePreview: preview ? {
      prefix: preview.prefix,
      pathLabel: preview.pathLabel,
      path: preview.path,
      onOpen: () => {
        if (preview.path) openWorkspaceFromTool(preview.path);
      },
    } : undefined,
    evidence: options.evidence,
    evidenceLoaded: options.evidenceLoaded,
    onOpenEvidence: options.onOpenEvidence,
  };
}

type ToolCallSource = ToolCallInfo | Accessor<ToolCallInfo>;

/** 将 Hub 投影的 tool call 映射为 @peri/ui ToolActivityRow。 */
export function ToolCallCard(props: {
  toolCall: ToolCallSource;
  variant?: 'default' | 'activity';
  projectCwd?: string | null;
}) {
  const [evidenceLoaded, setEvidenceLoaded] = createSignal(false);
  const tool = () => typeof props.toolCall === 'function' ? props.toolCall() : props.toolCall;
  const state = createMemo(() => STATUS[(tool().status || '').toLowerCase()] || { label: tool().status || 'Unknown status', tone: 'neutral' as ToolCallStatus });
  const durationMs = createMemo(() => observedDurationMs(tool().startedAt, tool().completedAt));
  const durationBadge = createMemo(() => {
    const ms = durationMs();
    if (ms === null) return null;
    if (!['done', 'failed'].includes(state().tone)) return null;
    return formatElapsedBadge(ms);
  });
  const errorText = createMemo(() => [tool().publicError?.code, tool().publicError?.message].filter(Boolean).join(': '));
  const tone = () => state().tone;
  const narration = createMemo(() => narrateToolCall(tool(), {
    tone: tone(),
    statusLabel: state().label,
    running: tone() === 'running',
    terminal: ['done', 'failed', 'neutral'].includes(tone()),
    projectCwd: props.projectCwd,
  }));
  const evidenceMeta = createMemo(() => toolEvidence(tool().kind, tool().arguments, tool().result));
  const showEmptyOutput = () => tool().resultOmitted === false
    && (tool().result === undefined || tool().result === null)
    && !errorText()
    && !['running', 'queued', 'approval'].includes(tone());
  const showLegacyOutput = () => tool().resultOmitted === null
    && (tool().result === undefined || tool().result === null)
    && !errorText()
    && !['running', 'queued', 'approval'].includes(tone());
  const evidence = createMemo(() => buildEvidence({
    tool: tool(),
    evidence: evidenceMeta(),
    errorText: errorText(),
    showEmptyOutput: showEmptyOutput(),
    showLegacyOutput: showLegacyOutput(),
  }));

  const rowProps = createMemo(() => mapNarrationToRowProps(narration(), {
    status: tone(),
    statusLabel: state().label,
    durationBadge: durationBadge(),
    toolCallId: tool().toolCallId || undefined,
    variant: props.variant,
    evidence: evidence(),
    evidenceLoaded: evidenceLoaded(),
    onOpenEvidence: () => setEvidenceLoaded(true),
  }));

  return <ToolActivityRow {...rowProps()} />;
}

/** 聊天 transcript 活动组；activity 变体由父级 chat-activity-chain 提供轨道。 */
export function ToolActivityGroup(props: { children: unknown; variant?: 'default' | 'activity' }) {
  return (
    <UiToolActivityGroup variant={props.variant} showRail={props.variant !== 'activity'}>
      {props.children as never}
    </UiToolActivityGroup>
  );
}
