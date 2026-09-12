import { For, Show } from 'solid-js';
import type { ChatEntry } from '@/entities/chat/chat-view';
import { isPlanSystemChatEntry } from '@/entities/chat/plan-system-entry';
import { Badge } from '@peri/ui';
import { Check, Circle, ListTodo, X } from 'lucide-solid';

function StateIcon(props: { status: string }) {
  if (props.status === 'completed') return <Check size={13} strokeWidth={2.4} class="text-success-solid" aria-hidden="true" />;
  if (props.status === 'in_progress') return <Circle size={10} strokeWidth={2} class="animate-pulse text-accent-solid" aria-hidden="true" />;
  return <X size={12} strokeWidth={2} class="text-text-faint" aria-hidden="true" />;
}

function stateTone(status: string): 'success' | 'info' | 'neutral' {
  if (status === 'completed') return 'success';
  if (status === 'in_progress') return 'info';
  return 'neutral';
}

function stateLabel(status: string) {
  if (status === 'completed') return 'Done';
  if (status === 'in_progress') return 'Running';
  return 'Queued';
}

/** Chat timeline row for `plan:{turn|global}` system entries (Control plan stays in StatusArea). */
export function PlanSystemEntryRow(props: { entry: ChatEntry }) {
  const entries = () => props.entry.planEntries ?? [];
  return (
    <Show when={isPlanSystemChatEntry(props.entry) && entries().length > 0}>
      <article
        class="plan-system-entry mx-auto mb-8 w-full max-w-(--chat-content-max) overflow-hidden rounded-12 border border-border-subtle bg-surface-overlay shadow-decision"
        data-testid="plan-system-entry"
        aria-label="Agent plan"
      >
        <header class="flex min-h-34 items-center gap-6 border-b border-divider px-10 py-6 text-11 font-650 text-text-primary">
          <ListTodo size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>Plan</span>
        </header>
        <ol class="m-0 grid list-none gap-4 p-8">
          <For each={entries()}>{(entry) => (
            <li class="grid min-h-24 grid-cols-status-row items-center gap-7 rounded-7 px-6 py-4">
              <span class="grid size-14 place-items-center"><StateIcon status={entry.status} /></span>
              <span class="overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">
                {entry.status === 'in_progress' && entry.activeForm ? entry.activeForm : entry.content}
              </span>
              <Badge tone={stateTone(entry.status)}>{stateLabel(entry.status)}</Badge>
            </li>
          )}</For>
        </ol>
      </article>
    </Show>
  );
}
