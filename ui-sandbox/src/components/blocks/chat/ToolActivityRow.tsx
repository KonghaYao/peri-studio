import { Check, ChevronRight, Circle, X } from 'lucide-solid';
import { createMemo, createSignal, Show } from 'solid-js';
import { CopyButton } from '@/components/ui';
import { cn } from '@/lib/cn';

export type ToolCallStatus = 'queued' | 'running' | 'done' | 'failed' | 'approval';

const STATUS: Record<ToolCallStatus, { label: string; tone: 'pending' | 'running' | 'success' | 'error' | 'permission' }> = {
  queued: { label: 'Queued', tone: 'pending' },
  running: { label: 'Running', tone: 'running' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'error' },
  approval: { label: 'Approval', tone: 'permission' },
};

function StatusMark(props: { tone: string }) {
  if (props.tone === 'success') return <Check size={12} strokeWidth={2.5} class="text-success-solid" />;
  if (props.tone === 'error') return <X size={11} strokeWidth={2.2} class="text-danger-solid" />;
  const color = props.tone === 'permission' ? 'text-warning-solid' : props.tone === 'running' ? 'text-accent-solid' : 'text-content-faint';
  return <Circle size={9} strokeWidth={2} class={color} />;
}

function EvidenceBlock(props: { label: string; value: string; tone?: 'error' }) {
  return (
    <div class="min-w-0 rounded-md bg-surface-sunken px-2.5 py-2">
      <div class="mb-1 flex items-center gap-2">
        <span class="text-10 font-medium text-content-muted">{props.label}</span>
        <span class="flex-1" />
        <CopyButton text={props.value} label={`Copy ${props.label}`} />
      </div>
      <pre class={`m-0 max-h-40 overflow-auto font-mono text-11 leading-relaxed whitespace-pre-wrap ${props.tone === 'error' ? 'text-danger-solid' : 'text-content-primary'}`}>
        <code>{props.value}</code>
      </pre>
    </div>
  );
}

/** 工具活动行：时间线摘要，非 card；running 用浅灰底。 */
export function ToolActivityRow(props: {
  name: string;
  input?: string;
  output?: string;
  error?: string;
  status: ToolCallStatus;
  duration?: string;
}) {
  const [open, setOpen] = createSignal(false);
  const state = createMemo(() => STATUS[props.status]);
  const hasEvidence = () => props.input || props.output || props.error;

  return (
    <div class="min-w-0">
      <button
        type="button"
        disabled={!hasEvidence()}
        class={cn(
          'grid w-full min-h-7 grid-cols-tool-row items-center gap-2 rounded-md px-2 text-left transition-colors duration-(--duration-fast)',
          props.status === 'running' ? 'bg-sidebar-selected' : 'hover:bg-interaction-hover',
          !hasEvidence() && 'cursor-default',
        )}
        aria-expanded={open()}
        onClick={() => hasEvidence() && setOpen((v) => !v)}
      >
        <span class="grid size-4 place-items-center">
          <StatusMark tone={state().tone} />
        </span>
        <span class="min-w-0 truncate text-12 text-content-primary">
          <span class="font-medium">{props.name}</span>
          <Show when={props.input}>
            <code class="ml-1.5 font-mono text-10 text-content-muted">{props.input}</code>
          </Show>
        </span>
        <span class="flex-none text-10 text-content-muted tabular-nums">
          {state().label}
          <Show when={props.duration}><span class="ml-1">{props.duration}</span></Show>
        </span>
        <Show when={hasEvidence()}>
          <ChevronRight size={13} class={cn('text-content-faint transition-transform duration-(--duration-fast)', open() && 'rotate-90')} />
        </Show>
      </button>
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

/** 聊天 transcript 里的工具活动组容器。 */
export function ToolActivityGroup(props: { children: unknown }) {
  return (
    <div class="flex max-w-(--chat-tool-activity-max) flex-col gap-0.5 rounded-lg border border-border-subtle bg-surface-overlay p-1.5">
      {props.children as never}
    </div>
  );
}
