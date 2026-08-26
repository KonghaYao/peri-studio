import { For } from 'solid-js';
import { Icon } from '../components/ui';
import type { VisualScenarioDefinition, VisualScenarioId } from './scenarios';

function ScenarioIcon(props: { id: VisualScenarioId }) {
  const paths: Record<VisualScenarioId, string[]> = {
    conversation: ['M5 5.5h10v7H9l-3.5 3v-3H5z'],
    'long-conversation': ['M4 4.5h10v6H7.5L4 13.5z', 'M8 13h8v3H12l-2.5 2v-2'],
    markdown: ['M6 4.5h8v11H6z', 'M8 8h4M8 11h4'],
    tools: ['M5 15 15 5M6 5l2 2M12 13l2 2', 'M4 4.5 7.5 4 8 7.5 5 8zM12 12.5l3-.5 1 3.5-3.5.5z'],
    'permission-streaming': ['M10 3.5 16 6v4.5c0 3.5-2.4 5.6-6 6.8-3.6-1.2-6-3.3-6-6.8V6z', 'M8 10l1.4 1.4L12.5 8'],
    elicitation: ['M6.8 7.5a3.2 3.2 0 1 1 4.2 3c-.8.4-1 1-1 1.8', 'M10 15h.01'],
    subtasks: ['M5 5h4v4H5zM11 11h4v4h-4z', 'M9 7h3v6h-1'],
    resources: ['M4 6h5l1.5 2H16v8H4z', 'M7 11h6M7 13.5h4'],
    assets: ['M4 4.5h12v11H4z', 'm6 12 2.3-2.5 1.8 1.8 1.9-2.2', 'M7.5 8h.01'],
    'terminal-readonly': ['M10 3.5a6.5 6.5 0 1 1-4.6 1.9', 'M4 3.5v4h4', 'M10 7v3.5l2.5 1.5'],
    catalog: ['M10 3.5v4M10 12.5v4M3.5 10h4M12.5 10h4', 'm5.5 5.5 2 2M12.5 12.5l2 2M14.5 5.5l-2 2M7.5 12.5l-2 2'],
    'design-tokens': ['M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z'],
  };
  return <Icon class="size-18!">{paths[props.id].map((path) => <path d={path} />)}</Icon>;
}

export function VisualScenarioSidebar(props: { scenarios: readonly VisualScenarioDefinition[]; current: VisualScenarioId }) {
  return <aside class="visual-scenario-sidebar" aria-label="Design examples">
    <div class="visual-scenario-sidebar__actions">
      <a href="?scenario=catalog" class="visual-scenario-sidebar__new"><span aria-hidden="true">＋</span><strong>New example</strong></a>
      <a href="?scenario=conversation" class="visual-scenario-sidebar__search" aria-label="Open basic conversation"><Icon><circle cx="8.5" cy="8.5" r="5" /><path d="m12.2 12.2 4 4" /></Icon></a>
    </div>
    <div class="visual-scenario-sidebar__eyebrow"><span>Examples</span><span>{props.scenarios.length}</span></div>
    <nav>
      <For each={props.scenarios}>{(scenario) => <a
        href={`?scenario=${scenario.id}`}
        aria-current={scenario.id === props.current ? 'page' : undefined}
        title={scenario.description}
      >
        <span class="visual-scenario-sidebar__icon" aria-hidden="true"><ScenarioIcon id={scenario.id} /></span>
        <span class="visual-scenario-sidebar__copy"><strong>{scenario.label}</strong><small>{scenario.description}</small></span>
      </a>}</For>
    </nav>
    <footer><span class="visual-scenario-sidebar__signal" aria-hidden="true" /><span>Mock data</span><code>{props.current}</code></footer>
  </aside>;
}
