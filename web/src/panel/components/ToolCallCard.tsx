import { createMemo, createSignal, Show, type Accessor } from 'solid-js';
import type { ToolCallInfo, ToolCallKind } from '../lib/chat-view';
import { CopyButton } from '../../components/ui';
import { Check, Circle, CodeXml, X } from 'lucide-solid';

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Queued', tone: 'pending' },
  awaitingpermission: { label: 'Approval', tone: 'permission' },
  awaiting_permission: { label: 'Approval', tone: 'permission' },
  permission_required: { label: 'Approval', tone: 'permission' },
  running: { label: 'Running', tone: 'running' },
  in_progress: { label: 'Running', tone: 'running' },
  completed: { label: 'Done', tone: 'success' },
  complete: { label: 'Done', tone: 'success' },
  error: { label: 'Failed', tone: 'error' },
  failed: { label: 'Failed', tone: 'error' },
  denied: { label: 'Denied', tone: 'error' },
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
  if (family === 'shell') return {
    inputLabel: 'Command', input, outputLabel: 'Output', output,
  };
  if (family === 'read') return {
    inputLabel: 'File', input, outputLabel: 'Content', output,
  };
  if (family === 'write') return {
    inputLabel: 'Change', input, outputLabel: 'Result', output,
  };
  return { inputLabel: 'Input', input, outputLabel: 'Output', output };
}

function ToolStateIcon(props: { tone: string }) {
  if (props.tone === 'success') return <Check size={13} strokeWidth={2.4} class="text-success" aria-hidden="true" />;
  if (props.tone === 'error') return <X size={12} strokeWidth={2.2} class="text-danger" aria-hidden="true" />;
  const color = props.tone === 'permission' ? 'text-warning' : props.tone === 'running' ? 'text-success' : 'text-text-faint';
  return <Circle size={10} strokeWidth={2} class={color} aria-hidden="true" />;
}

function DataSection(props: { label: string; value: unknown; tone?: 'error' }) {
  const text = createMemo(() => readableToolValue(props.value));
  const lines = createMemo(() => text() ? text().split('\n').length : 0);
  return (
    <section class={`tool-data min-w-0 overflow-hidden border rounded-9 ${props.tone === 'error' ? 'tool-data--error border-danger-border bg-surface' : 'border-divider bg-sidebar-bg'}`}>
      <header class="flex min-h-34 items-center gap-8 pr-7 pl-10 border-b border-divider"><strong class="text-text-secondary text-11 font-650">{props.label}</strong><span class="flex-1 text-text-muted text-10 tabular-nums" aria-label={`${lines()} lines`} title={`${lines()} lines`}>{lines()}</span><CopyButton text={text()} label={`Copy ${props.label}`} size="compact" class="min-h-28 border-0 bg-transparent text-text-secondary" /></header>
      <pre class={`max-h-300 m-0 px-11 py-10 overflow-auto whitespace-pre-wrap wrap-anywhere font-mono text-12 leading-155 ${props.tone === 'error' ? 'text-danger' : 'text-text-primary'}`}><code>{text()}</code></pre>
    </section>
  );
}

type ToolCallSource = ToolCallInfo | Accessor<ToolCallInfo>;

export function ToolCallCard(props: { toolCall: ToolCallSource }) {
  const [evidenceLoaded, setEvidenceLoaded] = createSignal(false);
  const tool = () => typeof props.toolCall === 'function' ? props.toolCall() : props.toolCall;
  const state = createMemo(() => STATUS[(tool().status || '').toLowerCase()] || { label: tool().status || 'Unknown status', tone: 'neutral' });
  const duration = createMemo(() => observedDuration(tool().startedAt, tool().completedAt));
  const errorText = createMemo(() => [tool().publicError?.code, tool().publicError?.message].filter(Boolean).join(': '));
  const inputSummary = createMemo(() => compactToolInput(tool().arguments));
  // 摘要永远保持轻量；大 JSON 只在用户首次展开后序列化、挂载。
  const evidence = createMemo(() => toolEvidence(tool().kind, tool().arguments, tool().result));
  return (
    <details
      class={`tool-card tool-card--${state().tone} group w-full max-w-(--tool-activity-max) overflow-hidden border-0 border-b border-divider bg-surface ${state().tone === 'error' ? 'text-danger' : 'text-text-primary'}`}
      onToggle={(event) => { if (event.currentTarget.open) setEvidenceLoaded(true); }}
    >
      <summary
        class={`tool-card__summary grid min-h-(--pattern-row-height) grid-cols-[15px_minmax(0,1fr)_auto_18px] items-center gap-6 px-5 cursor-pointer list-none rounded-7 hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-1 ${state().tone === 'running' ? 'bg-selected' : ''}`}
        onClick={() => setEvidenceLoaded(true)}
      >
        <span class="tool-card__mark grid size-14 place-items-center"><ToolStateIcon tone={state().tone} /></span>
        <span class="tool-card__identity grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-6"><strong class="overflow-hidden text-ellipsis whitespace-nowrap text-11 font-semibold" title={tool().toolCallId || undefined}>{tool().name || 'Tool call'}</strong><Show when={inputSummary()}>{(input) => <code class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-9 text-text-muted">{input()}</code>}</Show><code class="sr-only">{tool().toolCallId || 'No call ID'}</code></span>
        <span class="tool-card__status text-9 text-text-muted"><span>{state().label}</span><Show when={duration()}>{(value) => <span class="tool-card__duration ml-4 tabular-nums" aria-label={`Observed duration ${value()}`}>{value()}</span>}</Show></span>
        <span class="tool-card__chevron grid size-20 place-items-center text-text-muted" aria-hidden="true"><CodeXml size={13} strokeWidth={1.8} /></span>
      </summary>
      <Show when={evidenceLoaded()}>
      <div class="tool-card__body ml-22 flex flex-col gap-8 border-l border-divider py-7 pl-10 bg-surface">
        <Show when={tool().arguments !== undefined && tool().arguments !== null}><DataSection label={evidence().inputLabel} value={evidence().input} /></Show>
        <Show when={tool().argumentsOmitted}><OmittedEvidence label="Input not loaded" size={tool().argumentsBytes} noun="input" /></Show>
        <Show when={tool().result !== undefined && tool().result !== null}><DataSection label={evidence().outputLabel} value={evidence().output} /></Show>
        <Show when={tool().content !== undefined && tool().content !== null}><DataSection label="Tool content" value={tool().content} /></Show>
        <Show when={tool().contentOmitted}><OmittedEvidence label="Tool content not loaded" size={tool().contentBytes} noun="tool content" /></Show>
        <Show when={tool().locations !== undefined && tool().locations !== null}><DataSection label="Locations" value={tool().locations} /></Show>
        <Show when={tool().locationsOmitted}><OmittedEvidence label="Locations not loaded" size={tool().locationsBytes} noun="location evidence" /></Show>
        <Show when={errorText()}><DataSection label="Public error" value={errorText()} tone="error" /></Show>
        <Show when={tool().resultOmitted}>
          <OmittedEvidence label="Output not loaded" size={tool().resultBytes} noun="result" />
        </Show>
        <Show when={tool().resultOmitted === false && (tool().result === undefined || tool().result === null)}><Show when={!errorText() && !['running', 'pending', 'permission'].includes(state().tone)}><p class="tool-card__empty m-0 text-text-secondary text-11 leading-15">The tool returned no displayable output.</p></Show></Show>
        <Show when={tool().resultOmitted === null && (tool().result === undefined || tool().result === null)}><Show when={!errorText() && !['running', 'pending', 'permission'].includes(state().tone)}><p class="tool-card__legacy m-0 text-text-secondary text-11 italic leading-15">This history record has no output; the legacy projection did not record whether it was empty or omitted due to size limits.</p></Show></Show>
      </div>
      </Show>
    </details>
  );
}

function OmittedEvidence(props: { label: string; size: number | null | undefined; noun: string }) {
  const size = () => readableBytes(props.size ?? null);
  return <aside class="tool-card__omitted flex flex-col gap-3 m-0 px-10 py-9 border border-warning-border rounded-9 bg-surface text-text-secondary text-11 leading-15" role="note"><strong class="text-warning text-11">{props.label}</strong><span>Hub observed {props.noun}{size() ? ` of about ${size()}` : ''} that exceeds the page projection limit. The content was not written to this session view.</span></aside>;
}
