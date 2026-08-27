import { For, Show, createMemo, createSignal } from 'solid-js';
import type { AgentActivityInfo, AgentPlanEntryInfo } from '../lib/control-view';
import type { ChatEntry } from '../lib/chat-view';
import { selectChatFileChanges } from '../lib/chat-file-changes';
import { Ban, Bot, Check, Circle, CircleAlert, GitBranch, Info, ListTodo, Pause, Workflow, X } from 'lucide-solid';
import { VSCodeFileIcon } from './VSCodeFileIcon';

type StatusTab = 'todo' | 'async' | 'changes';

export interface StatusAreaProps {
  plan: AgentPlanEntryInfo[];
  activities: AgentActivityInfo[];
  entries: ChatEntry[];
  active: boolean;
}

function StateIcon(props: { status: string }) {
  if (props.status === 'completed') return <Check size={13} strokeWidth={2.4} class="text-success" aria-hidden="true" />;
  if (props.status === 'failed') return <X size={12} strokeWidth={2.2} class="text-danger" aria-hidden="true" />;
  if (props.status === 'warning') return <CircleAlert size={12} strokeWidth={2} class="text-warning" aria-hidden="true" />;
  if (props.status === 'suspended') return <Pause size={12} strokeWidth={2} class="text-text-muted" aria-hidden="true" />;
  if (props.status === 'cancelled') return <Ban size={12} strokeWidth={2} class="text-text-muted" aria-hidden="true" />;
  if (props.status === 'info') return <Info size={12} strokeWidth={2} class="text-link" aria-hidden="true" />;
  const active = props.status === 'in_progress' || props.status === 'running';
  return <Circle size={active ? 10 : 9} strokeWidth={2} class={active ? 'text-success' : 'text-text-faint'} aria-hidden="true" />;
}

function stateLabel(status: string) {
  if (status === 'completed') return 'Done';
  if (status === 'in_progress' || status === 'running') return 'Running';
  if (status === 'failed') return 'Failed';
  if (status === 'warning') return 'Warning';
  if (status === 'suspended') return 'Paused';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'info') return 'Info';
  return 'Queued';
}

export function StatusArea(props: StatusAreaProps) {
  const [activeTab, setActiveTab] = createSignal<StatusTab>('todo');
  const taskActivities = createMemo(() => props.activities.filter((activity) => ['subagent', 'background_task', 'workflow'].includes(activity.kind)));
  const changes = createMemo(() => selectChatFileChanges(props.entries));
  const completedTodos = createMemo(() => props.plan.filter((entry) => entry.status === 'completed').length);
  const tabs = createMemo(() => [
    props.active && props.plan.length > 0 ? { id: 'todo' as const, label: 'Todo', count: props.plan.length, icon: ListTodo } : null,
    props.active && taskActivities().length > 0 ? { id: 'async' as const, label: 'Async', count: taskActivities().length, icon: Workflow } : null,
    changes().length > 0 ? { id: 'changes' as const, label: 'Changes', count: changes().length, icon: GitBranch } : null,
  ].filter((tab): tab is NonNullable<typeof tab> => tab !== null));
  const visibleTab = () => tabs().some((tab) => tab.id === activeTab()) ? activeTab() : tabs()[0]?.id;

  return <Show when={tabs().length > 0}>
    <section class="status-area mx-auto mb-8 w-full max-w-(--container-chat) px-20 desk:max-wide:max-w-(--container-chat-narrow) desk:max-wide:px-18 wide:max-w-(--container-chat) wide:px-20 max-desk:max-w-(--container-chat-narrow) max-narrow:px-10" aria-label="Status area">
      <div class="overflow-hidden rounded-12 border border-border-subtle bg-surface shadow-float">
        <div class="flex min-h-34 items-center gap-2 border-b border-divider px-5" role="tablist" aria-label="Work status">
          <For each={tabs()}>{(tab) => <button
            type="button"
            role="tab"
            aria-selected={visibleTab() === tab.id}
            aria-controls={`status-panel-${tab.id}`}
            class={`inline-flex min-h-(--control-height-compact) items-center gap-5 rounded-7 border-0 px-7 text-10 font-600 transition-colors ${visibleTab() === tab.id ? 'bg-selected text-text-primary' : 'bg-transparent text-text-muted hover:bg-hover hover:text-text-primary'}`}
            onClick={() => setActiveTab(tab.id)}
          ><tab.icon size={13} strokeWidth={1.8} /><span>{tab.label}</span><span class="min-w-13 text-center text-9 tabular-nums text-text-muted">{tab.id === 'todo' && tab.count ? `${completedTodos()}/${tab.count}` : tab.count}</span></button>}</For>
        </div>
        <div class="ui-scrollbar max-h-(--status-panel-max-height) overflow-auto px-10 py-6 text-11" role="tabpanel" id={`status-panel-${visibleTab()}`}>
          <Show when={visibleTab() === 'todo'}>
            <ol class="m-0 grid list-none gap-3 p-0"><For each={props.plan}>{(entry) => <li class="grid min-h-24 grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-7">
              <span class="grid size-14 place-items-center"><StateIcon status={entry.status} /></span>
              <span class="overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">{entry.status === 'in_progress' && entry.activeForm ? entry.activeForm : entry.content}</span>
              <small class="text-9 text-text-muted">{stateLabel(entry.status)}</small>
            </li>}</For></ol>
          </Show>
          <Show when={visibleTab() === 'async'}>
            <ol class="m-0 grid list-none gap-1 p-0"><For each={taskActivities()}>{(activity) => <li class="grid min-h-24 grid-cols-[14px_54px_minmax(0,1fr)_auto] items-center gap-7">
              <span class="grid size-14 place-items-center"><StateIcon status={activity.status} /></span>
              <span class="inline-flex items-center gap-4 text-9 font-650 uppercase tracking-4 text-text-muted">
                <Show when={activity.kind === 'subagent'} fallback={<Workflow size={12} strokeWidth={1.8} />}><Bot size={12} strokeWidth={1.8} /></Show>
                {activity.kind === 'subagent' ? 'Agent' : 'Workflow'}
              </span>
              <span class="overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">{activity.label || 'Background task'}</span>
              <span class="inline-flex items-center gap-5 whitespace-nowrap text-9 text-text-muted">
                <span>{stateLabel(activity.status)}</span>
                <Show when={activity.metrics.tool_count}><span class="tabular-nums">{activity.metrics.tool_count} tools</span></Show>
              </span>
            </li>}</For></ol>
          </Show>
          <Show when={visibleTab() === 'changes'}>
            <ol class="m-0 grid list-none gap-1 p-0 font-mono"><For each={changes()}>{(change) => <li class="grid min-h-24 grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-7">
              <VSCodeFileIcon path={change.path} size={15} class="size-14" />
              <span class="overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">{change.path}</span>
              <span class="uppercase text-9 tracking-4 text-text-muted">{change.operation}</span>
            </li>}</For></ol>
          </Show>
        </div>
      </div>
    </section>
  </Show>;
}
