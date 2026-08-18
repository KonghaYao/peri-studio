import { createMemo, Show } from 'solid-js';
import type { ToolCallInfo } from '../lib/chat-view';
import { CopyButton } from '../../components/ui';
import { CollapsibleSection } from './shared/CollapsibleSection';

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Pending', tone: 'pending' },
  awaitingpermission: { label: 'Waiting for your permission', tone: 'permission' },
  running: { label: 'Running', tone: 'running' },
  in_progress: { label: 'Running', tone: 'running' },
  completed: { label: 'Completed', tone: 'success' },
  complete: { label: 'Completed', tone: 'success' },
  error: { label: 'Failed', tone: 'error' },
  failed: { label: 'Failed', tone: 'error' },
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

function DataSection(props: { label: string; value: unknown; tone?: 'error' }) {
  const text = createMemo(() => readableToolValue(props.value));
  const lines = createMemo(() => text() ? text().split('\n').length : 0);
  return (
    <section class={`tool-data min-w-0 overflow-hidden border rounded-9 ${props.tone === 'error' ? 'tool-data--error border-danger-border bg-danger-soft' : 'border-divider bg-sidebar-bg'}`}>
      <header class="flex min-h-34 items-center gap-8 pr-7 pl-10 border-b border-divider"><strong class="text-text-secondary text-11 font-650">{props.label}</strong><span class="flex-1 text-text-muted text-10">{lines()} lines</span><CopyButton text={text()} label={`Copy ${props.label}`} size="compact" class="min-h-28 border-0 bg-transparent text-text-secondary" /></header>
      <pre class={`max-h-300 m-0 px-11 py-10 overflow-auto whitespace-pre-wrap wrap-anywhere font-mono text-12 leading-155 ${props.tone === 'error' ? 'text-danger' : 'text-text-primary'}`}><code>{text()}</code></pre>
    </section>
  );
}

export function ToolCallCard(props: { toolCall: ToolCallInfo }) {
  const tool = () => props.toolCall;
  const state = createMemo(() => STATUS[(tool().status || '').toLowerCase()] || { label: tool().status || 'Unknown status', tone: 'neutral' });
  const duration = createMemo(() => observedDuration(tool().startedAt, tool().completedAt));
  const errorText = createMemo(() => [tool().publicError?.code, tool().publicError?.message].filter(Boolean).join(': '));
  const omittedSize = createMemo(() => readableBytes(tool().resultBytes));
  const markTone = () => {
    const tone = state().tone;
    if (tone === 'success') return 'bg-success';
    if (tone === 'error') return 'bg-danger';
    if (tone === 'running' || tone === 'pending' || tone === 'permission') return 'bg-warning';
    return 'bg-text-muted';
  };
  return (
    <CollapsibleSection
      detailsClass={`tool-card tool-card--${state().tone} overflow-hidden border rounded-12 bg-surface-muted ${state().tone === 'error' ? 'border-danger-border' : 'border-border-subtle'}`}
      summaryClass="tool-card__summary flex min-h-48 items-center gap-9 px-10 py-7 cursor-pointer list-none focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-neg-2"
      open={state().tone === 'error'}
      mark={<span class={`tool-card__mark size-8 flex-none rounded-full ${markTone()}`} aria-hidden="true" />}
      copy={<span class="tool-card__identity flex min-w-0 flex-1 flex-col gap-1"><strong class="overflow-hidden text-text-primary text-13 font-semibold text-ellipsis whitespace-nowrap">{tool().name || 'Tool call'}</strong><code class="overflow-hidden text-text-muted font-mono text-10 leading-13 text-ellipsis whitespace-nowrap">{tool().toolCallId || 'No call ID'}</code></span>}
      meta={<><span class={`tool-card__status flex-none text-11 ${state().tone === 'error' ? 'text-danger' : 'text-text-secondary'}`}>{state().label}</span><Show when={duration()}>{(value) => <span class="tool-card__duration flex-none pl-8 border-l border-divider text-text-muted text-11" title="Time between start and completion events as observed by Hub">Hub observed {value()}</span>}</Show></>}
      chevronClass="tool-card__chevron text-text-muted text-18 transition-transform duration-140"
    >
      <div class="tool-card__body flex flex-col gap-10 p-11 border-t border-divider bg-surface">
        <Show when={tool().arguments !== undefined && tool().arguments !== null}><DataSection label="Input" value={tool().arguments} /></Show>
        <Show when={tool().result !== undefined && tool().result !== null}><DataSection label="Output" value={tool().result} /></Show>
        <Show when={errorText()}><DataSection label="Public error" value={errorText()} tone="error" /></Show>
        <Show when={tool().resultOmitted}>
          <aside class="tool-card__omitted flex flex-col gap-3 m-0 px-10 py-9 border border-warning-border rounded-9 bg-warning-soft text-text-secondary text-11 leading-15" role="note"><strong class="text-warning text-11">Output not loaded</strong><span>Hub observed a result{omittedSize() ? ` of about ${omittedSize()}` : ''} that exceeds the page projection limit. The content was not written to this session view.</span></aside>
        </Show>
        <Show when={tool().resultOmitted === false && (tool().result === undefined || tool().result === null)}><Show when={!errorText() && !['running', 'pending', 'permission'].includes(state().tone)}><p class="tool-card__empty m-0 text-text-secondary text-11 leading-15">The tool returned no displayable output.</p></Show></Show>
        <Show when={tool().resultOmitted === null && (tool().result === undefined || tool().result === null)}><Show when={!errorText() && !['running', 'pending', 'permission'].includes(state().tone)}><p class="tool-card__legacy m-0 text-text-secondary text-11 italic leading-15">This history record has no output; the legacy projection did not record whether it was empty or omitted due to size limits.</p></Show></Show>
      </div>
    </CollapsibleSection>
  );
}
