import { createSignal, For } from 'solid-js';
import { Badge, Tabs } from '@/components/ui';
import { Check, Circle, GitBranch, ListTodo, Workflow } from 'lucide-solid';

/** Tier 4 · 状态区组合：Tabs + 任务列表。 */
export function StatusAreaLayout() {
  const [statusTab, setStatusTab] = createSignal('todo');

  return (
    <div class="max-w-md overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay">
      <Tabs
        value={statusTab()}
        onChange={setStatusTab}
        tabs={[
          { value: 'todo', label: <span class="inline-flex items-center gap-1.5"><ListTodo size={13} />Todo <Badge tone="neutral">1/3</Badge></span> },
          { value: 'async', label: <span class="inline-flex items-center gap-1.5"><Workflow size={13} />Async <Badge tone="neutral">2</Badge></span> },
          { value: 'changes', label: <span class="inline-flex items-center gap-1.5"><GitBranch size={13} />Changes <Badge tone="neutral">3</Badge></span> },
        ]}
      />
      <div class="flex flex-col gap-1 overflow-auto p-2" style={{ 'max-height': 'var(--status-panel-max-height)' }}>
        <For each={[
          { state: 'done' as const, label: 'Locate recovery boundary' },
          { state: 'running' as const, label: 'Verify browser projection' },
          { state: 'queued' as const, label: 'Summarize focused checks' },
        ]}>
          {(item) => (
            <div class="flex items-center gap-2 rounded-md px-2 py-1 text-12 text-content-primary">
              <span class="grid size-3.5 flex-none place-items-center">
                {item.state === 'done' && <Check size={13} class="text-success-solid" />}
                {item.state === 'running' && <Circle size={10} class="animate-pulse text-accent-solid" />}
                {item.state === 'queued' && <Circle size={10} class="text-content-faint" />}
              </span>
              <span class="flex-1 truncate">{item.label}</span>
              <Badge tone={item.state === 'done' ? 'success' : item.state === 'running' ? 'info' : 'neutral'}>
                {item.state === 'done' ? 'Done' : item.state === 'running' ? 'Running' : 'Queued'}
              </Badge>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
