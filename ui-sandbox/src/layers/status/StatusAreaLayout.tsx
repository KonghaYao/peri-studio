import { createSignal, For } from 'solid-js';
import {
  Badge,
  StatusAreaShell,
  TabsContent,
  TabsTrigger,
  statusAreaPanelClass,
  statusAreaRowClass,
  statusAreaTabTriggerClass,
} from '@peri/ui';
import { Check, Circle, GitBranch, ListTodo, Workflow } from 'lucide-solid';

const DEMO_ROWS = [
  { state: 'done' as const, label: 'Locate recovery boundary' },
  { state: 'running' as const, label: 'Verify browser projection' },
  { state: 'queued' as const, label: 'Summarize focused checks' },
];

const DEMO_TABS = [
  { id: 'todo', label: 'Todo', count: '1/3', icon: ListTodo },
  { id: 'async', label: 'Async', count: '2', icon: Workflow },
  { id: 'changes', label: 'Changes', count: '3', icon: GitBranch },
] as const;

/** Tier 4 · 状态区：消费 @peri/ui StatusAreaShell（T3），mock plan/async/changes 行。 */
export function StatusAreaLayout() {
  const [statusTab, setStatusTab] = createSignal<(typeof DEMO_TABS)[number]['id']>('todo');
  const [expanded, setExpanded] = createSignal(true);

  return (
    <div class="max-w-md">
      <StatusAreaShell
        tabsValue={statusTab()}
        onTabsChange={(value) => setStatusTab(value as (typeof DEMO_TABS)[number]['id'])}
        expanded={expanded()}
        onExpandedChange={setExpanded}
        tabBar={(
          <For each={DEMO_TABS}>{(tab) => (
            <TabsTrigger value={tab.id} class={statusAreaTabTriggerClass}>
              <tab.icon size={14} strokeWidth={1.8} aria-hidden="true" />
              <span class="truncate">{tab.label}</span>
              <span class="tabular-nums text-11 text-content-muted">{tab.count}</span>
            </TabsTrigger>
          )}</For>
        )}
      >
        <TabsContent value="todo" class={statusAreaPanelClass}>
          <div class="flex flex-col gap-2">
            <For each={DEMO_ROWS}>
              {(item) => (
                <div class={statusAreaRowClass}>
                  <span class="grid size-20 shrink-0 place-items-center">
                    {item.state === 'done' && <Check size={13} strokeWidth={2.4} class="text-success-solid" aria-hidden="true" />}
                    {item.state === 'running' && <Circle size={10} strokeWidth={2} class="animate-pulse text-accent-solid" aria-hidden="true" />}
                    {item.state === 'queued' && <Circle size={9} strokeWidth={2} class="text-content-faint" aria-hidden="true" />}
                  </span>
                  <span class="min-w-0 flex-1 truncate text-12 text-content-primary">{item.label}</span>
                  <Badge tone={item.state === 'done' ? 'success' : item.state === 'running' ? 'info' : 'neutral'}>
                    {item.state === 'done' ? 'Done' : item.state === 'running' ? 'Running' : 'Queued'}
                  </Badge>
                </div>
              )}
            </For>
          </div>
        </TabsContent>
        <TabsContent value="async" class={statusAreaPanelClass}>
          <p class="text-12 text-content-muted">Background tasks demo panel.</p>
        </TabsContent>
        <TabsContent value="changes" class={statusAreaPanelClass}>
          <p class="text-12 text-content-muted">Changed files demo panel.</p>
        </TabsContent>
      </StatusAreaShell>
    </div>
  );
}
