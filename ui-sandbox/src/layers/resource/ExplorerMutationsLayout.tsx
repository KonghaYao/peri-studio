import { createSignal, For } from 'solid-js';
import { Button } from '@/lib/catalog-ui';
import { ExplorerMutationsPanel } from '@/components/blocks/resource/ExplorerMutationsPanel';
import {
  EXPLORER_MUTATIONS_DEMO_MODES,
  type ExplorerMutationsDemoMode,
} from '@/components/blocks/resource/explorer-mutations-demo-data';

/** Tier 4 · Explorer 文件树 mutations 状态矩阵（mock，无 wire）。 */
export function ExplorerMutationsLayout() {
  const [mode, setMode] = createSignal<ExplorerMutationsDemoMode>('idle');

  return (
    <div class="flex flex-col gap-16">
      <p class="text-13 text-content-secondary">
        Mock Explorer mutations: toolbar, context menu, inline naming, Move to…, permanent delete, conflict,
        disabled, and pending. Wire is not connected in sandbox.
      </p>
      <div class="flex flex-wrap gap-8">
        <For each={EXPLORER_MUTATIONS_DEMO_MODES}>
          {(m) => (
            <Button size="sm" variant={mode() === m.id ? 'primary' : 'default'} onClick={() => setMode(m.id)}>
              {m.label}
            </Button>
          )}
        </For>
      </div>
      <ExplorerMutationsPanel demoMode={mode()} />
    </div>
  );
}
