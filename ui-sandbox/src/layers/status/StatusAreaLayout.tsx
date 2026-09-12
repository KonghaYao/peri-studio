import { createSignal, For, Show } from 'solid-js';
import { Badge, IconButton, cn } from '@peri/ui';
import { Check, ChevronDown, Circle, GitBranch, ListTodo, Workflow } from 'lucide-solid';

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

/** Tier 4 · 状态区：与生产 StatusArea 共用决策面卡壳与行样式。 */
export function StatusAreaLayout() {
  const [statusTab, setStatusTab] = createSignal<(typeof DEMO_TABS)[number]['id']>('todo');
  const [expanded, setExpanded] = createSignal(true);
  const statusRowClass = 'flex min-h-36 w-full items-center gap-12 rounded-md px-8 py-6 text-left transition-colors duration-(--duration-fast) hover:bg-interaction-hover';

  return (
    <div
      class="max-w-md overflow-hidden border border-border-subtle bg-surface-overlay"
      style={{ 'border-radius': 'var(--decision-radius)' }}
    >
      <header class="flex min-h-36 items-center gap-12 px-16 pt-14 pb-8">
        <span class="text-12 font-medium text-content-secondary">Work status</span>
        <div class="ml-auto flex min-w-0 items-center gap-2 text-content-muted">
          <div class="flex min-w-0 items-center gap-2" role="tablist" aria-label="Work status">
            <For each={DEMO_TABS}>{(tab) => (
              <button
                type="button"
                role="tab"
                aria-selected={statusTab() === tab.id}
                class={cn(
                  'inline-flex h-28 items-center gap-6 rounded-md border-0 px-8 text-12 transition-colors duration-(--duration-fast)',
                  statusTab() === tab.id
                    ? 'bg-accent-soft font-medium text-content-primary'
                    : 'text-content-muted hover:bg-interaction-hover hover:text-content-primary',
                )}
                onClick={() => setStatusTab(tab.id)}
              >
                <tab.icon size={14} strokeWidth={1.8} aria-hidden="true" />
                <span>{tab.label}</span>
                <Badge tone="neutral" class="min-w-0 px-6">{tab.count}</Badge>
              </button>
            )}</For>
          </div>
          <IconButton
            size="sm"
            label={expanded() ? 'Collapse status panel' : 'Expand status panel'}
            showTooltip={false}
            class="border-0 bg-transparent text-content-muted hover:bg-transparent hover:text-content-primary"
            aria-expanded={expanded()}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDown
              size={14}
              strokeWidth={1.8}
              class={cn('transition-transform duration-(--duration-fast)', !expanded() && 'rotate-180')}
            />
          </IconButton>
        </div>
      </header>
      <Show when={expanded()}>
        <div class="flex flex-col gap-2 overflow-auto px-16 pb-14 pt-4" style={{ 'max-height': 'var(--status-panel-max-height)' }}>
          <For each={DEMO_ROWS}>
            {(item) => (
              <div class={statusRowClass}>
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
      </Show>
    </div>
  );
}
