import { Check, ChevronRight, Circle, X } from 'lucide-solid';
import { createMemo, createSignal, Show, type Accessor } from 'solid-js';
import type { ToolCallInfo, ToolCallKind } from '@/entities/chat/chat-view';
import { CopyButton } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';

export type ToolCallStatus = 'queued' | 'running' | 'done' | 'failed' | 'approval' | 'neutral';

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

export function observedDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null;
  const elapsed = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  if (elapsed < 1000) return `${elapsed} ms`;
  if (elapsed < 10_000) return `${(elapsed / 1000).toFixed(1)} s`;
  if (elapsed < 60_000) return `${Math.round(elapsed / 1000)} s`;
  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.round((elapsed % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

export function readableBytes(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function compactToolInput(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return typeof value === 'string' ? value : '';
  const record = value as Record<string, unknown>;
  const preferred = ['file_path', 'filePath', 'path', 'command', 'cmd', 'query', 'pattern', 'uri', 'url', 'file']
    .map((key) => record[key])
    .find((item) => typeof item === 'string');
  if (typeof preferred === 'string') return preferred;
  const first = Object.values(record).find((item) => typeof item === 'string' || typeof item === 'number');
  return first === undefined ? '' : String(first);
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

function StatusMark(props: { tone: ToolCallStatus }) {
  if (props.tone === 'done') return <Check size={12} strokeWidth={2.5} class="text-success-solid" />;
  if (props.tone === 'failed') return <X size={11} strokeWidth={2.2} class="text-danger-solid" />;
  const color = props.tone === 'approval' ? 'text-warning-solid' : props.tone === 'running' ? 'text-accent-solid' : 'text-content-faint';
  return <Circle size={9} strokeWidth={2} class={color} />;
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

/** 工具活动行：时间线摘要，非 card；running 用浅灰底。 */
export function ToolActivityRow(props: {
  name: string;
  inputSummary?: string;
  status: ToolCallStatus;
  statusLabel: string;
  duration?: string | null;
  toolCallId?: string;
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
    if (!open()) props.onOpenEvidence();
    setOpen((value) => !value);
  };

  return (
    <div class="tool-activity-row min-w-0" data-testid="tool-activity-row">
      <button
        type="button"
        disabled={!hasEvidence()}
        data-testid="tool-activity-row-summary"
        class={cn(
          'tool-activity-row__summary grid w-full min-h-(--pattern-row-height) grid-cols-tool-row items-center gap-8 rounded-md px-8 text-left transition-colors duration-(--duration-fast)',
          props.status === 'running' ? 'bg-sidebar-selected' : 'hover:bg-interaction-hover',
          !hasEvidence() && 'cursor-default',
        )}
        aria-expanded={open()}
        onClick={toggle}
      >
        <span class="grid size-16 place-items-center">
          <StatusMark tone={props.status} />
        </span>
        <span class="min-w-0 truncate text-12 text-content-primary">
          <span class="font-medium">{props.name}</span>
          <Show when={props.inputSummary}>
            <code class="ml-4 font-mono text-10 text-content-muted">{props.inputSummary}</code>
          </Show>
          <Show when={props.toolCallId}>
            <code class="sr-only">{props.toolCallId}</code>
          </Show>
        </span>
        <span class="flex-none text-10 text-content-muted tabular-nums">
          {props.statusLabel}
          <Show when={props.duration}><span class="ml-4">{props.duration}</span></Show>
        </span>
        <Show when={hasEvidence()}>
          <ChevronRight size={13} class={cn('text-content-faint transition-transform duration-(--duration-fast)', open() && 'rotate-90')} />
        </Show>
      </button>
      <Show when={open() && hasEvidence() && props.evidenceLoaded}>
        <div class="tool-activity-row__body mt-4 flex flex-col gap-6 pb-4 pl-16 pr-8" data-testid="tool-activity-row-body">
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
    </div>
  );
}

/** 聊天 transcript 里的工具活动组容器。 */
export function ToolActivityGroup(props: { children: unknown }) {
  return (
    <div class="tool-activity-group flex max-w-(--tool-activity-max) min-w-0 flex-col gap-2 rounded-lg border border-border-subtle bg-surface-overlay p-6" data-testid="tool-activity-group">
      {props.children as never}
    </div>
  );
}

type ToolCallSource = ToolCallInfo | Accessor<ToolCallInfo>;

/** 将 Hub 投影的 tool call 映射为 ToolActivityRow。 */
export function ToolCallCard(props: { toolCall: ToolCallSource }) {
  const [evidenceLoaded, setEvidenceLoaded] = createSignal(false);
  const tool = () => typeof props.toolCall === 'function' ? props.toolCall() : props.toolCall;
  const state = createMemo(() => STATUS[(tool().status || '').toLowerCase()] || { label: tool().status || 'Unknown status', tone: 'neutral' as ToolCallStatus });
  const duration = createMemo(() => observedDuration(tool().startedAt, tool().completedAt));
  const errorText = createMemo(() => [tool().publicError?.code, tool().publicError?.message].filter(Boolean).join(': '));
  const inputSummary = createMemo(() => compactToolInput(tool().arguments));
  const evidence = createMemo(() => toolEvidence(tool().kind, tool().arguments, tool().result));
  const tone = () => state().tone;
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
      name={tool().name || 'Tool call'}
      inputSummary={inputSummary() || undefined}
      status={tone()}
      statusLabel={state().label}
      duration={duration()}
      toolCallId={tool().toolCallId || undefined}
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
