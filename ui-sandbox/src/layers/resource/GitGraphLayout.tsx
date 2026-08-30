import { GitGraphPanel } from '@/components/blocks/git';
import { DEMO_GRAPH_COMMITS } from './git-demo-data';

/** Tier 4 · Git Graph：VS Code Git Graph 风格大面板。 */
export function GitGraphLayout() {
  return (
    <section class="h-full min-h-0 w-full" aria-label="Git Graph">
      <GitGraphPanel commits={DEMO_GRAPH_COMMITS} />
    </section>
  );
}
