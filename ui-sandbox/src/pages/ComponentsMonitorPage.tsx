import { ComponentCatalogExtrasShell } from '@/pages/ComponentCatalogExtrasShell';
import { TierHeader } from '@/pages/shared/DemoSection';

const MONITOR_SECTIONS = [
  'monitor-timeline',
  'monitor-trace-turn-tree',
  'io-viewer',
  'monitor-io-detail',
] as const;

/** T4 · Langfuse Monitor：timeline、IO viewer 与 observation detail 组合。 */
export function ComponentsMonitorPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Comp · Monitor"
        title="Monitor"
        description="Trace timeline、全量 turn 树、IO viewer 与 observation detail（自 peri-fuse 抽象）。"
      />
      <ComponentCatalogExtrasShell sections={[...MONITOR_SECTIONS]} />
    </div>
  );
}
