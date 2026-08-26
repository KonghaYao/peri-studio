import { For, Show, createMemo, createSignal } from 'solid-js';
import type { AgentActivityInfo, AgentPlanEntryInfo } from '../lib/control-view';
import { resourceWorkspace } from '../store';
import { Bot, Check, Circle, FileText, GitBranch, ListTodo, Workflow, X } from 'lucide-solid';

type StatusTab = 'todo' | 'async' | 'changes';

export interface StatusAreaProps {
  plan: AgentPlanEntryInfo[];
  activities: AgentActivityInfo[];
  active: boolean;
}

function StateIcon(props: { status: string }) {
  if (props.status === 'completed') return <Check size={13} strokeWidth={2.4} class="text-success" aria-hidden="true" />;
  if (props.status === 'failed' || props.status === 'warning') return <X size={12} strokeWidth={2.2} class="text-danger" aria-hidden="true" />;
  const active = props.status === 'in_progress' || props.status === 'running';
  return <Circle size={active ? 10 : 9} strokeWidth={2} class={active ? 'text-success' : 'text-text-faint'} aria-hidden="true" />;
}

function changeText(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

export function StatusArea(props: StatusAreaProps) {
  const [activeTab, setActiveTab] = createSignal<StatusTab>('todo');
  const taskActivities = createMemo(() => props.activities.filter((activity) => ['subagent', 'background_task', 'workflow'].includes(activity.kind)));
  const changes = createMemo(() => resourceWorkspace().repositories.flatMap((repo) => Object.values(repo.groups).flatMap((group) => group.changes)));
  const completedTodos = createMemo(() => props.plan.filter((entry) => entry.status === 'completed').length);
  const hasContent = createMemo(() => changes().length > 0 || (props.active && (props.plan.length > 0 || taskActivities().length > 0)));
  const tabs = () => [
    { id: 'todo' as const, label: 'Todo', count: props.plan.length, icon: ListTodo },
    { id: 'async' as const, label: 'Async', count: taskActivities().length, icon: Workflow },
    { id: 'changes' as const, label: 'Changes', count: changes().length, icon: GitBranch },
  ];

  return <Show when={hasContent()}>
    <section class="status-area mx-auto mb-8 w-full max-w-(--container-chat) px-20 desk:max-wide:max-w-(--container-chat-narrow) desk:max-wide:px-18 wide:max-w-(--container-chat) wide:px-20 max-desk:max-w-(--container-chat-narrow) max-narrow:px-10" aria-label="Status area">
      <div class="overflow-hidden rounded-12 border border-border-subtle bg-surface shadow-float">
        <div class="flex min-h-34 items-center gap-2 border-b border-divider px-5" role="tablist" aria-label="Work status">
          <For each={tabs()}>{(tab) => <button
            type="button"
            role="tab"
            aria-selected={activeTab() === tab.id}
            aria-controls={`status-panel-${tab.id}`}
            class={`inline-flex min-h-(--control-height-compact) items-center gap-5 rounded-7 border-0 px-7 text-10 font-600 transition-colors ${activeTab() === tab.id ? 'bg-selected text-text-primary' : 'bg-transparent text-text-muted hover:bg-hover hover:text-text-primary'}`}
            onClick={() => setActiveTab(tab.id)}
          ><tab.icon size={13} strokeWidth={1.8} /><span>{tab.label}</span><span class="min-w-13 text-center text-9 tabular-nums text-text-muted">{tab.id === 'todo' && tab.count ? `${completedTodos()}/${tab.count}` : tab.count}</span></button>}</For>
        </div>
        <div class="ui-scrollbar max-h-(--status-panel-max-height) overflow-auto px-10 py-6 text-11" role="tabpanel" id={`status-panel-${activeTab()}`}>
          <Show when={activeTab() === 'todo'}>
            <ol class="m-0 grid list-none gap-1 p-0"><For each={props.plan}>{(entry) => <li class="grid min-h-24 grid-cols-[14px_minmax(0,1fr)] items-center gap-7">
              <span class="grid size-14 place-items-center"><StateIcon status={entry.status} /></span>
              <span class={`overflow-hidden text-ellipsis whitespace-nowrap ${entry.status === 'completed' ? 'text-text-muted' : 'text-text-primary'}`}>{entry.status === 'in_progress' && entry.activeForm ? entry.activeForm : entry.content}</span>
            </li>}</For></ol>
          </Show>
          <Show when={activeTab() === 'async'}>
            <ol class="m-0 grid list-none gap-1 p-0"><For each={taskActivities()}>{(activity) => <li class="grid min-h-24 grid-cols-[14px_54px_minmax(0,1fr)_auto] items-center gap-7">
              <span class="grid size-14 place-items-center"><StateIcon status={activity.status} /></span>
              <span class="inline-flex items-center gap-4 text-9 font-650 uppercase tracking-4 text-text-muted">
                <Show when={activity.kind === 'subagent'} fallback={<Workflow size={12} strokeWidth={1.8} />}><Bot size={12} strokeWidth={1.8} /></Show>
                {activity.kind === 'subagent' ? 'Agent' : 'Workflow'}
              </span>
              <span class="overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">{activity.label || 'Background task'}</span>
              <span class="text-10 tabular-nums text-text-muted">{activity.metrics.tool_count ? `${activity.metrics.tool_count} tools` : ''}</span>
            </li>}</For></ol>
          </Show>
          <Show when={activeTab() === 'changes'}>
            <ol class="m-0 grid list-none gap-1 p-0 font-mono"><For each={changes()}>{(change) => <li class="grid min-h-24 grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-7">
              <FileText size={13} strokeWidth={1.7} class="text-text-muted" aria-hidden="true" />
              <span class="overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">{changeText(change.path, 'Unknown file')}</span>
              <span class="uppercase text-9 tracking-4 text-text-muted">{changeText(change.status, 'changed')}</span>
            </li>}</For></ol>
          </Show>
        </div>
      </div>
    </section>
  </Show>;
}
