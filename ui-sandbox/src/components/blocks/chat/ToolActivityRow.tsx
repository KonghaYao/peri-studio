import {
  Check,
  ChevronRight,
  CircleX,
  Clock3,
  Loader2,
  ShieldQuestion,
  Wrench,
  type LucideIcon,
} from 'lucide-solid';
import { createMemo, createSignal, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { CopyButton } from '@/components/ui';
import { cn } from '@/lib/cn';

export type ToolCallStatus = 'queued' | 'running' | 'done' | 'failed' | 'approval';

const STATUS: Record<ToolCallStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  approval: 'Approval',
};

function ToolStatusIcon(props: { status: ToolCallStatus; label: string }) {
  return (
    <span
      class={cn(
        'grid size-5.5 shrink-0 place-items-center rounded-md text-content-muted',
        props.status === 'done' && 'text-success-solid',
        props.status === 'failed' && 'text-danger-solid',
        props.status === 'approval' && 'text-accent-solid',
      )}
      role="img"
      aria-label={props.label}
      title={props.label}
    >
      <Show when={props.status === 'done'}><Check size={14} strokeWidth={2.4} /></Show>
      <Show when={props.status === 'failed'}><CircleX size={14} strokeWidth={2} /></Show>
      <Show when={props.status === 'approval'}><ShieldQuestion size={14} strokeWidth={1.9} /></Show>
      <Show when={props.status === 'running'}><Loader2 size={14} strokeWidth={2} class="animate-spin" /></Show>
      <Show when={props.status === 'queued'}><Clock3 size={14} strokeWidth={1.9} /></Show>
    </span>
  );
}

function EvidenceBlock(props: { label: string; value: string; tone?: 'error' }) {
  return (
    <div class="min-w-0 rounded-md bg-surface-sunken px-2.5 py-2">
      <div class="mb-1 flex items-center gap-2">
        <span class="text-10 font-medium text-content-muted">{props.label}</span>
        <span class="flex-1" />
        <CopyButton text={props.value} label={`Copy ${props.label}`} />
      </div>
      <pre class={cn(
        'm-0 max-h-40 overflow-auto font-mono text-11 leading-relaxed whitespace-pre-wrap',
        props.tone === 'error' ? 'text-danger-solid' : 'text-content-primary',
      )}>
        <code>{props.value}</code>
      </pre>
    </div>
  );
}

/** 工具活动行：Fenix 风格 icon + 说明摘要；证据区只用于 sandbox 演示。 */
export function ToolActivityRow(props: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  input?: string;
  output?: string;
  error?: string;
  status: ToolCallStatus;
  duration?: string;
}) {
  const [open, setOpen] = createSignal(false);
  const statusLabel = createMemo(() => STATUS[props.status]);
  const hasEvidence = () => Boolean(props.input || props.output || props.error);
  const isRunning = () => props.status === 'running';

  return (
    <div class="min-w-0">
      <div class={cn(
        'grid w-full grid-cols-tool-row items-center gap-2 rounded-md p-0.5 text-left',
        isRunning() && 'bg-sidebar-selected',
      )}>
        <span class="relative z-1 grid size-5.5 place-items-center rounded-full bg-surface-canvas text-content-muted" aria-hidden="true">
          <Dynamic component={props.icon ?? Wrench} size={15} strokeWidth={1.8} />
        </span>

        <span class="flex min-w-0 items-baseline gap-2 overflow-hidden">
          <span class="min-w-0 truncate text-12 font-normal text-content-muted" title={props.title}>{props.title}</span>
          <Show when={props.subtitle}>
            <span class="min-w-0 truncate text-11 text-content-faint">{props.subtitle}</span>
          </Show>
          <Show when={props.error}>
            <span class="min-w-0 truncate text-11 text-danger-solid">{props.error}</span>
          </Show>
        </span>

        <span class="flex shrink-0 items-center justify-self-end gap-3 text-10 font-medium text-content-muted">
          <Show when={props.duration}>
            <span class="min-w-10.5 text-right tabular-nums">{props.duration}</span>
          </Show>
          <ToolStatusIcon status={props.status} label={statusLabel()} />
        </span>

        <Show when={hasEvidence()}>
          <button
            type="button"
            class="grid size-5.5 place-items-center rounded-md text-content-faint hover:bg-interaction-hover"
            aria-label={open() ? 'Collapse tool details' : 'Expand tool details'}
            aria-expanded={open()}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronRight size={13} class={cn('transition-transform duration-(--duration-fast)', open() && 'rotate-90')} />
          </button>
        </Show>
      </div>

      <Show when={open() && hasEvidence()}>
        <div class="mt-1 flex flex-col gap-1.5 pb-1 pl-6 pr-2">
          <Show when={props.input}><EvidenceBlock label="Input" value={props.input!} /></Show>
          <Show when={props.output}><EvidenceBlock label="Output" value={props.output!} /></Show>
          <Show when={props.error}><EvidenceBlock label="Error" value={props.error!} tone="error" /></Show>
        </div>
      </Show>
    </div>
  );
}

/** 聊天 transcript 里的 Fenix 风格工具活动组。 */
export function ToolActivityGroup(props: { children: unknown }) {
  return (
    <div class="tool-activity-chain relative isolate grid w-full max-w-(--chat-tool-activity-max) min-w-0 gap-px">
      <span class="absolute inset-y-0 left-(--chat-activity-rail-left) z-0 w-px bg-border-strong" aria-hidden="true" />
      {props.children as never}
    </div>
  );
}
