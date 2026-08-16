import { For, Show } from 'solid-js';
import type { AgentPlanEntryInfo } from '../lib/control-view';
import { CollapsibleSection } from './shared/CollapsibleSection';

export interface AgentPlanPanelProps {
  entries: AgentPlanEntryInfo[];
}

const STATUS_LABEL: Record<AgentPlanEntryInfo['status'], string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
};

/** Standard ACP Plan with a capability-gated Peri active-form enhancement. */
export function AgentPlanPanel(props: AgentPlanPanelProps) {
  const completed = () => props.entries.filter((entry) => entry.status === 'completed').length;
  const current = () => props.entries.find((entry) => entry.status === 'in_progress');
  const statusTone = (status: AgentPlanEntryInfo['status']) => {
    if (status === 'in_progress') return 'border-accent bg-accent shadow-accent-ring';
    if (status === 'completed') return 'border-success bg-success';
    return 'border-text-faint';
  };
  return <Show when={props.entries.length > 0}>
    <CollapsibleSection
      detailsClass="agent-plan w-(--container-activity) flex-none mx-auto mt-10 border border-border-subtle rounded-14 bg-surface text-text-primary"
      summaryClass="flex min-h-44 items-center gap-10 px-11 py-5 cursor-pointer list-none focus-visible:rounded-13 focus-visible:outline-offset-neg-2"
      label="Agent execution plan"
      mark={<span class="agent-plan__mark size-9 flex-none border-2 border-accent rounded-3" aria-hidden="true" />}
      copy={<span class="agent-plan__summary-copy flex min-w-0 flex-1 items-baseline gap-8">
        <strong class="text-12 font-680">Execution plan</strong>
        <span class="overflow-hidden text-text-secondary text-11 text-ellipsis whitespace-nowrap">{current()?.activeForm || current()?.content || 'View task progress'}</span>
      </span>}
      meta={<span class="agent-plan__progress text-text-muted text-10 tabular-nums">{completed()}/{props.entries.length}</span>}
      chevronClass="agent-plan__chevron text-text-muted text-18 transition-transform duration-140"
    >
      <ol class="flex max-h-260 flex-col overflow-auto m-0 pt-5 pr-11 pb-10 pl-11 border-t border-divider list-none">
        <For each={props.entries}>{(entry) => <li class={`agent-plan__item agent-plan__item--${entry.status} grid grid-cols-plan gap-9 items-start px-2 py-8`}>
          <span class={`agent-plan__status size-8 mt-4 border rounded-full ${statusTone(entry.status)}`} aria-hidden="true" />
          <span class="agent-plan__content grid min-w-0 gap-2">
            <strong class={`text-11p5 font-610 leading-14 ${entry.status === 'completed' ? 'text-text-secondary line-through' : ''}`}>{entry.status === 'in_progress' && entry.activeForm ? entry.activeForm : entry.content}</strong>
            <Show when={entry.status === 'in_progress' && entry.activeForm && entry.activeForm !== entry.content}>
              <span class="text-text-muted text-10">{entry.content}</span>
            </Show>
          </span>
          <span class="agent-plan__label text-text-muted text-10 whitespace-nowrap">{STATUS_LABEL[entry.status]}</span>
        </li>}</For>
      </ol>
    </CollapsibleSection>
  </Show>;
}
