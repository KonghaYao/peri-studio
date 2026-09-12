import {
  Ban,
  Check,
  ChevronRight,
  Circle,
  CircleX,
  Clock3,
  FilePen,
  FilePlus,
  FileText,
  FolderSearch,
  Globe,
  HelpCircle,
  ListTodo,
  Loader2,
  Search,
  ShieldQuestion,
  Sparkles,
  Terminal,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-solid';
import { createMemo, createSignal, Show, type Accessor } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { ToolCallInfo, ToolCallKind } from '@/entities/chat/chat-view';
import {
  formatElapsedBadge,
  narrateToolCall,
  type ToolCardKind,
  type ToolNarration,
} from '@/features/chat/tool-narration';
import { openWorkspaceFromTool } from '@/store';
import { CopyButton } from '@peri/ui';
import { cn } from '@peri/ui';

export type ToolCallStatus = 'queued' | 'running' | 'done' | 'failed' | 'approval' | 'neutral';

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


function ToolStatusIcon(props: { status: ToolCallStatus; label: string }) {
  return (
    <span
      class={cn(
        'tool-call-row-status grid size-22 shrink-0 place-items-center rounded-6 text-content-muted',
        props.status === 'done' && 'text-success-solid',
        props.status === 'failed' && 'text-danger-solid',
        props.status === 'approval' && 'text-accent-solid',
        props.status === 'neutral' && 'text-content-faint',
      )}
      data-tool-status={props.status}
      role="img"
      aria-label={props.label}
      title={props.label}
    >
      <Show when={props.status === 'done'}><Check size={14} strokeWidth={2.4} /></Show>
      <Show when={props.status === 'failed'}><CircleX size={14} strokeWidth={2} /></Show>
      <Show when={props.status === 'approval'}><ShieldQuestion size={14} strokeWidth={1.9} /></Show>
      <Show when={props.status === 'running'}><Loader2 size={14} strokeWidth={2} class="animate-spin" /></Show>
      <Show when={props.status === 'queued'}><Clock3 size={14} strokeWidth={1.9} /></Show>
      <Show when={props.status === 'neutral'}>
        <Show when={props.label === 'Cancelled'} fallback={<Circle size={11} strokeWidth={2} />}>
          <Ban size={14} strokeWidth={1.9} />
        </Show>
      </Show>
    </span>
  );
}

function EvidenceBlock(props: { label: string; value: string; tone?: 'error' }) {
  return (
    <div class="min-w-0 rounded-md bg-surface-sunken px-10 py-8">
      <div class="mb-4 flex items-center gap-8">
        <span class="text-10 font-medium text-content-muted">{props.label}</span>
        <span class="flex-1" />
        <CopyButton text={props.value} label={`Copy ${props.label}`} />
      </div>
      <pre class={cn(
        'm-0 max-h-180 overflow-auto font-mono text-11 leading-relaxed whitespace-pre-wrap',
        props.tone === 'error' ? 'text-danger-solid' : 'text-content-primary',
      )}>
        <code>{props.value}</code>
      </pre>
    </div>
  );
}

function OmittedEvidence(props: { label: string; size: number | null | undefined; noun: string }) {
  const size = () => readableBytes(props.size ?? null);
  return (
    <aside class="flex flex-col gap-4 rounded-md border border-warning-border bg-surface-overlay px-10 py-8 text-11 leading-normal text-content-secondary" role="note">
      <strong class="text-11 text-warning-solid">{props.label}</strong>
      <span>Hub observed {props.noun}{size() ? ` of about ${size()}` : ''} that exceeds the page projection limit. The content was not written to this session view.</span>
    </aside>
  );
}

/** 工具活动行：Fenix 风格摘要行 + Peri 展开证据区。 */
export function ToolActivityRow(props: {
  narration: ToolNarration;
  status: ToolCallStatus;
  statusLabel: string;
  durationBadge: string | null;
  toolCallId?: string;
  variant?: 'default' | 'activity';
  evidenceLoaded: boolean;
  onOpenEvidence: () => void;
  evidence: {
    inputLabel: string;
    input?: unknown;
    inputOmitted?: boolean | null;
    inputBytes?: number | null;
    outputLabel: string;
    output?: unknown;
    outputOmitted?: boolean | null;
    outputBytes?: number | null;
    content?: unknown;
    contentOmitted?: boolean | null;
    contentBytes?: number | null;
    locations?: unknown;
    locationsOmitted?: boolean | null;
    locationsBytes?: number | null;
    errorText?: string;
    showEmptyOutput?: boolean;
    showLegacyOutput?: boolean;
  };
}) {
  const [open, setOpen] = createSignal(false);
  let evidenceBody: HTMLDivElement | undefined;
  const hasEvidence = () => props.evidence.input !== undefined && props.evidence.input !== null
    || props.evidence.inputOmitted
    || props.evidence.output !== undefined && props.evidence.output !== null
    || props.evidence.outputOmitted
    || props.evidence.content !== undefined && props.evidence.content !== null
    || props.evidence.contentOmitted
    || props.evidence.locations !== undefined && props.evidence.locations !== null
    || props.evidence.locationsOmitted
    || Boolean(props.evidence.errorText)
    || props.evidence.showEmptyOutput
    || props.evidence.showLegacyOutput;

  const toggle = () => {
    if (!hasEvidence()) return;
    if (!open()) {
      props.onOpenEvidence();
      setOpen(true);
      requestAnimationFrame(() => {
        evidenceBody?.scrollIntoView?.({ block: 'nearest' });
      });
      return;
    }
    setOpen(false);
  };

  const openPath = (event: MouseEvent) => {
    event.stopPropagation();
    const preview = props.narration.filePreview;
    if (preview?.path) openWorkspaceFromTool(preview.path);
  };

  const activity = () => props.variant === 'activity';
  const isRunning = () => props.status === 'running';
  const isError = () => props.status === 'failed';
  const isCanceled = () => props.status === 'neutral' && props.statusLabel === 'Cancelled';
  const filePreview = () => props.narration.filePreview;

  const rowContent = (
    <>
      <div
        class={cn(
          'tool-call-row-compact min-h-(--pattern-row-height) rounded-6 p-2',
          isError() && 'is-error',
          isCanceled() && 'is-cancelled opacity-55',
          isRunning() && 'is-running bg-sidebar-selected hover:bg-sidebar-selected',
        )}
      >
        <div
          class="chat-tool-call-row grid w-full min-w-0 grid-cols-tool-row items-center gap-9 text-left text-inherit"
          data-testid="tool-activity-row-summary"
        >
          <span
            class="tool-call-row-icon relative z-1 grid size-22 shrink-0 place-items-center rounded-full bg-surface-canvas text-content-muted"
            data-tool-kind={props.narration.kind}
            aria-hidden="true"
          >
            <Dynamic component={TOOL_ICONS[props.narration.kind]} size={15} strokeWidth={1.8} />
          </span>

          <span
            class={cn(
              'tool-call-row-copy block min-w-0 overflow-hidden',
              filePreview() && 'is-file-preview',
            )}
          >
            <span class="tool-call-row-heading flex min-w-0 items-baseline gap-9 overflow-hidden">
              <Show
                when={filePreview()}
                fallback={(
                  <span class="tool-call-row-title min-w-0 truncate text-12 font-normal text-content-muted" title={props.narration.title}>
                    {props.narration.title}
                  </span>
                )}
              >
                {(preview) => (
                  <span class="tool-call-row-title inline-flex min-w-0 items-baseline gap-5 overflow-hidden text-12 font-normal text-content-muted" title={preview().path}>
                    <span class="shrink-0">{preview().prefix}</span>
                    <button
                      type="button"
                      data-testid="tool-activity-file-link"
                      class="tool-call-row-file-link inline-block min-w-0 max-w-full truncate align-bottom text-link hover:underline hover:underline-offset-2"
                      onClick={openPath}
                    >
                      {preview().pathLabel}
                    </button>
                  </span>
                )}
              </Show>
              <Show when={props.narration.subtitle}>
                <span class="tool-call-row-meta flex min-w-0 items-baseline gap-5 overflow-hidden text-11 font-normal text-content-faint">
                  <span class="truncate">{props.narration.subtitle}</span>
                </span>
              </Show>
              <Show when={props.narration.errorDetail}>
                <span class="tool-call-row-error min-w-0 truncate text-11 text-danger-solid" title={props.narration.errorDetail}>
                  {props.narration.errorDetail}
                </span>
              </Show>
            </span>
          </span>

          <span class="tool-call-row-end flex shrink-0 items-center justify-self-end gap-12">
            <Show when={props.durationBadge}>
              <span class="tool-call-row-duration min-w-42 text-right text-10 text-content-muted tabular-nums">
                {props.durationBadge}
              </span>
            </Show>
            <ToolStatusIcon status={props.status} label={props.statusLabel} />
          </span>

          <Show when={hasEvidence()}>
            <button
              type="button"
              data-testid="tool-activity-row-expand"
              class="chat-tool-call-row-expand grid size-22 shrink-0 place-items-center rounded-6 text-content-faint hover:bg-interaction-hover"
              aria-label={open() ? 'Collapse tool details' : 'Expand tool details'}
              aria-expanded={open()}
              onClick={toggle}
            >
              <ChevronRight size={13} class={cn('transition-transform duration-(--duration-fast)', open() && 'rotate-90')} />
            </button>
          </Show>

          <Show when={props.toolCallId}>
            <code class="sr-only">{props.toolCallId}</code>
          </Show>
        </div>
      </div>
      <Show when={open() && hasEvidence() && props.evidenceLoaded}>
        <div
          ref={evidenceBody}
          class={cn(
            'tool-activity-row__body flex flex-col gap-6 pb-8 pl-16 pr-10',
            activity() ? 'mt-0 border-t border-border-faint pt-8' : 'mt-4 pb-4 pr-8',
          )}
          data-testid="tool-activity-row-body"
        >
          <Show when={props.evidence.input !== undefined && props.evidence.input !== null}>
            <EvidenceBlock label={props.evidence.inputLabel} value={readableToolValue(props.evidence.input)} />
          </Show>
          <Show when={props.evidence.inputOmitted}>
            <OmittedEvidence label="Input not loaded" size={props.evidence.inputBytes} noun="input" />
          </Show>
          <Show when={props.evidence.output !== undefined && props.evidence.output !== null}>
            <EvidenceBlock label={props.evidence.outputLabel} value={readableToolValue(props.evidence.output)} />
          </Show>
          <Show when={props.evidence.content !== undefined && props.evidence.content !== null}>
            <EvidenceBlock label="Tool content" value={readableToolValue(props.evidence.content)} />
          </Show>
          <Show when={props.evidence.contentOmitted}>
            <OmittedEvidence label="Tool content not loaded" size={props.evidence.contentBytes} noun="tool content" />
          </Show>
          <Show when={props.evidence.locations !== undefined && props.evidence.locations !== null}>
            <EvidenceBlock label="Locations" value={readableToolValue(props.evidence.locations)} />
          </Show>
          <Show when={props.evidence.locationsOmitted}>
            <OmittedEvidence label="Locations not loaded" size={props.evidence.locationsBytes} noun="location evidence" />
          </Show>
          <Show when={props.evidence.errorText}>
            <EvidenceBlock label="Error" value={props.evidence.errorText!} tone="error" />
          </Show>
          <Show when={props.evidence.outputOmitted}>
            <OmittedEvidence label="Output not loaded" size={props.evidence.outputBytes} noun="result" />
          </Show>
          <Show when={props.evidence.showEmptyOutput}>
            <p class="m-0 text-11 leading-normal text-content-secondary">The tool returned no displayable output.</p>
          </Show>
          <Show when={props.evidence.showLegacyOutput}>
            <p class="m-0 text-11 italic leading-normal text-content-secondary">This history record has no output; the legacy projection did not record whether it was empty or omitted due to size limits.</p>
          </Show>
        </div>
      </Show>
    </>
  );

  return (
    <div
      class={cn(
        'tool-activity-row min-w-0',
        activity() && 'tool-activity-row--activity',
        !activity() && 'overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay p-6',
      )}
      data-testid="tool-activity-row"
    >
      {rowContent}
    </div>
  );
}

/** 聊天 transcript 里的工具活动组容器（sandbox：单卡多行）。 */
export function ToolActivityGroup(props: { children: unknown; variant?: 'default' | 'activity' }) {
  const activity = () => props.variant === 'activity';
  return (
    <div
      class={cn(
        'tool-activity-group',
        activity() ? 'tool-activity-group--activity tool-call-group-list grid w-full max-w-(--chat-tool-activity-max) min-w-0 gap-px' : 'flex flex-col gap-8 rounded-lg border border-border-subtle bg-surface-overlay p-8',
        !activity() && 'max-w-(--chat-tool-activity-max) min-w-0',
      )}
      data-testid="tool-activity-group"
    >
      {props.children as never}
    </div>
  );
}

type ToolCallSource = ToolCallInfo | Accessor<ToolCallInfo>;

/** 将 Hub 投影的 tool call 映射为 ToolActivityRow。 */
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
  const evidence = createMemo(() => toolEvidence(tool().kind, tool().arguments, tool().result));
  const showEmptyOutput = () => tool().resultOmitted === false
    && (tool().result === undefined || tool().result === null)
    && !errorText()
    && !['running', 'queued', 'approval'].includes(tone());
  const showLegacyOutput = () => tool().resultOmitted === null
    && (tool().result === undefined || tool().result === null)
    && !errorText()
    && !['running', 'queued', 'approval'].includes(tone());

  return (
    <ToolActivityRow
      narration={narration()}
      status={tone()}
      statusLabel={state().label}
      durationBadge={durationBadge()}
      toolCallId={tool().toolCallId || undefined}
      variant={props.variant}
      evidenceLoaded={evidenceLoaded()}
      onOpenEvidence={() => setEvidenceLoaded(true)}
      evidence={{
        inputLabel: evidence().inputLabel,
        input: tool().arguments,
        inputOmitted: tool().argumentsOmitted,
        inputBytes: tool().argumentsBytes,
        outputLabel: evidence().outputLabel,
        output: tool().result,
        outputOmitted: tool().resultOmitted,
        outputBytes: tool().resultBytes,
        content: tool().content,
        contentOmitted: tool().contentOmitted,
        contentBytes: tool().contentBytes,
        locations: tool().locations,
        locationsOmitted: tool().locationsOmitted,
        locationsBytes: tool().locationsBytes,
        errorText: errorText() || undefined,
        showEmptyOutput: showEmptyOutput(),
        showLegacyOutput: showLegacyOutput(),
      }}
    />
  );
}
