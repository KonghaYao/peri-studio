import { GitGraphPanel } from '@/components/blocks/git';
import { DEMO_GRAPH_COMMITS } from './git-demo-data';

/** Git Graph 整页：Table 视觉 + SVG DAG 叠加。 */
export function GitGraphLayout() {
  return (
    <section class="h-full min-h-0 w-full" aria-label="Git Graph">
      <GitGraphPanel commits={DEMO_GRAPH_COMMITS} />
    </section>
  );
}
