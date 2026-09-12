import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import type { AgentActivityInfo, AgentPlanEntryInfo, PeriTaskInfo } from '@/entities/chat/control-view';
import type { ChatEntry } from '@/entities/chat/chat-view';
import { selectChatFileChanges } from '@/entities/chat/chat-file-changes';
import { selectAsyncStatusItems } from '@/features/chat/async-status-items';
import { mapPlanStepStatus } from '@/features/chat/plan-step-status';
import { formatWorkspacePathLabel } from '@/features/chat/tool-file-link';
import { Ban, Bot, Check, Circle, CircleAlert, GitBranch, Info, ListTodo, Pause, Workflow, X } from 'lucide-solid';
import {
  Badge,
  PlanStep,
  StatusAreaShell,
  TabsContent,
  TabsTrigger,
  TaskItem,
  TaskItemFile,
  VSCodeFileIcon,
  cn,
  statusAreaPanelClass,
  statusAreaRowClass,
  statusAreaTabTriggerClass,
} from '@peri/ui';

type StatusTab = 'todo' | 'async' | 'changes';

export interface StatusAreaProps {
  plan: AgentPlanEntryInfo[];
  activities: AgentActivityInfo[];
  /** Session Doc Peri Task 视图；有数据时 Async 页优先用它。 */
  tasks?: PeriTaskInfo[];
  entries: ChatEntry[];
  projectCwd?: string | null;
  active: boolean;
}

function StateIcon(props: { status: string }) {
  if (props.status === 'completed') return <Check size={13} strokeWidth={2.4} class="text-success-solid" aria-hidden="true" />;
  if (props.status === 'failed') return <X size={12} strokeWidth={2.2} class="text-danger-solid" aria-hidden="true" />;
  if (props.status === 'warning') return <CircleAlert size={12} strokeWidth={2} class="text-warning-solid" aria-hidden="true" />;
  if (props.status === 'suspended') return <Pause size={12} strokeWidth={2} class="text-text-muted" aria-hidden="true" />;
  if (props.status === 'cancelled') return <Ban size={12} strokeWidth={2} class="text-text-muted" aria-hidden="true" />;
  if (props.status === 'info') return <Info size={12} strokeWidth={2} class="text-info-solid" aria-hidden="true" />;
  const active = props.status === 'in_progress' || props.status === 'running';
  return <Circle size={active ? 10 : 9} strokeWidth={2} class={active ? 'animate-pulse text-accent-solid' : 'text-text-faint'} aria-hidden="true" />;
}

function stateTone(status: string): 'success' | 'info' | 'neutral' | 'warning' | 'danger' {
  if (status === 'completed') return 'success';
  if (status === 'in_progress' || status === 'running') return 'info';
  if (status === 'failed') return 'danger';
  if (status === 'warning') return 'warning';
  return 'neutral';
}

function isAsyncInFlight(status: string) {
  return status === 'in_progress' || status === 'running';
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

function planEntryLabel(entry: AgentPlanEntryInfo) {
  return entry.status === 'in_progress' && entry.activeForm ? entry.activeForm : entry.content;
}

function planAutoExpandSignature(plan: AgentPlanEntryInfo[]) {
  return plan.map((entry) =>
    `${entry.id}:${entry.status}:${entry.content}:${entry.activeForm ?? ''}`,
  ).join('\0');
}

function asyncAutoExpandSignature(items: Array<{ id: string; status: string; label: string }>) {
  return items.map((item) => `${item.id}:${item.status}:${item.label}`).join('\0');
}

export function StatusArea(props: StatusAreaProps) {
  const [activeTab, setActiveTab] = createSignal<StatusTab>('todo');
  const [panelExpanded, setPanelExpanded] = createSignal(true);
  const asyncItems = createMemo(() => selectAsyncStatusItems(props.tasks ?? [], props.activities));
  const changes = createMemo(() => selectChatFileChanges(props.entries));
  const completedTodos = createMemo(() => props.plan.filter((entry) => entry.status === 'completed').length);
  const showAsyncTab = createMemo(() => {
    const items = asyncItems();
    if (items.length === 0) return false;
    if (props.active) return true;
    return items.some((item) => isAsyncInFlight(item.status));
  });
  const tabs = createMemo(() => [
    props.active && props.plan.length > 0 ? { id: 'todo' as const, label: 'Todo', count: props.plan.length, icon: ListTodo } : null,
    showAsyncTab() ? { id: 'async' as const, label: 'Async', count: asyncItems().length, icon: Workflow } : null,
    changes().length > 0 ? { id: 'changes' as const, label: 'Changes', count: changes().length, icon: GitBranch } : null,
  ].filter((tab): tab is NonNullable<typeof tab> => tab !== null));
  const visibleTab = () => tabs().some((tab) => tab.id === activeTab()) ? activeTab() : tabs()[0]?.id;

  let lastPlanSig: string | undefined;
  let lastAsyncSig: string | undefined;

  createEffect(() => {
    const planSig = props.active && props.plan.length > 0
      ? planAutoExpandSignature(props.plan)
      : '';
    const asyncSig = showAsyncTab()
      ? asyncAutoExpandSignature(asyncItems())
      : '';

    const planChanged = lastPlanSig !== undefined && planSig !== lastPlanSig;
    const asyncChanged = lastAsyncSig !== undefined && asyncSig !== lastAsyncSig;

    if (planChanged && planSig) {
      setPanelExpanded(true);
      setActiveTab('todo');
    } else if (asyncChanged && asyncSig) {
      setPanelExpanded(true);
      if (asyncItems().some((item) => isAsyncInFlight(item.status))) {
        setActiveTab('async');
      }
    }

    lastPlanSig = planSig;
    lastAsyncSig = asyncSig;
  });

  const tabCountLabel = (tab: { id: StatusTab; count: number }) =>
    tab.id === 'todo' && tab.count ? `${completedTodos()}/${tab.count}` : String(tab.count);

  return <Show when={tabs().length > 0}>
    <StatusAreaShell
      class="ui-chat-column mb-8"
      data-testid="status-area"
      aria-label="Status area"
      tabsValue={visibleTab() ?? ''}
      onTabsChange={(value) => setActiveTab(value as StatusTab)}
      expanded={panelExpanded()}
      onExpandedChange={setPanelExpanded}
      tabBar={(
        <For each={tabs()}>{(tab) => (
          <TabsTrigger
            value={tab.id}
            id={`status-tab-${tab.id}`}
            aria-controls={`status-panel-${tab.id}`}
            class={statusAreaTabTriggerClass}
          >
            <tab.icon size={14} strokeWidth={1.8} aria-hidden="true" />
            <span class="truncate">{tab.label}</span>
            <span class="tabular-nums text-11 text-content-muted">{tabCountLabel(tab)}</span>
          </TabsTrigger>
        )}</For>
      )}
    >
      <TabsContent
        value="todo"
        id="status-panel-todo"
        aria-labelledby="status-tab-todo"
        class={statusAreaPanelClass}
      >
              <div class="flex flex-col gap-2">
                <For each={props.plan}>{(entry) => (
                  <PlanStep
                    status={mapPlanStepStatus(entry.status)}
                    label={planEntryLabel(entry)}
                    class="min-h-36 rounded-md px-8 py-6 transition-colors duration-(--duration-fast) hover:bg-interaction-hover"
                  >
                    <div class="flex items-center justify-end">
                      <Badge tone={stateTone(entry.status)}>{stateLabel(entry.status)}</Badge>
                    </div>
                  </PlanStep>
                )}</For>
              </div>
      </TabsContent>
      <TabsContent
        value="async"
        id="status-panel-async"
        aria-labelledby="status-tab-async"
        class={statusAreaPanelClass}
      >
              <ul class="m-0 flex list-none flex-col gap-2 p-0">
                <For each={asyncItems()}>{(item) => (
                  <li>
                    <TaskItem class={cn(statusAreaRowClass, 'text-12 text-content-primary')}>
                      <span class="grid size-20 shrink-0 place-items-center"><StateIcon status={item.status} /></span>
                      <span class="inline-flex w-54 shrink-0 items-center gap-4 text-10 font-semibold uppercase tracking-wide text-content-muted">
                        <Show when={item.badgeKind === 'agent'} fallback={<Workflow size={12} strokeWidth={1.8} aria-hidden="true" />}>
                          <Bot size={12} strokeWidth={1.8} aria-hidden="true" />
                        </Show>
                        {item.badgeKind === 'agent' ? 'Agent' : 'Workflow'}
                      </span>
                      <span class="min-w-0 flex-1 truncate">{item.label}</span>
                      <span class="inline-flex shrink-0 items-center gap-6 whitespace-nowrap">
                        <Badge tone={stateTone(item.status)}>{stateLabel(item.status)}</Badge>
                        <Show when={item.toolCount}>
                          <span class="text-10 tabular-nums text-content-muted">{item.toolCount} tools</span>
                        </Show>
                      </span>
                    </TaskItem>
                  </li>
                )}</For>
              </ul>
      </TabsContent>
      <TabsContent
        value="changes"
        id="status-panel-changes"
        aria-labelledby="status-tab-changes"
        class={statusAreaPanelClass}
      >
              <ul class="m-0 flex list-none flex-col gap-2 p-0">
                <For each={changes()}>{(change) => (
                  <li>
                    <TaskItem class={cn(statusAreaRowClass, 'font-mono text-12 text-content-primary')}>
                      <VSCodeFileIcon path={change.path} size={16} class="size-16 shrink-0" />
                      <TaskItemFile class="min-w-0 flex-1 truncate border-0 bg-transparent px-0 py-0" title={change.path}>
                        {formatWorkspacePathLabel(change.path, props.projectCwd)}
                      </TaskItemFile>
                      <span class="shrink-0 text-10 uppercase tracking-wide text-content-muted">{change.operation}</span>
                    </TaskItem>
                  </li>
                )}</For>
              </ul>
      </TabsContent>
    </StatusAreaShell>
  </Show>;
}
