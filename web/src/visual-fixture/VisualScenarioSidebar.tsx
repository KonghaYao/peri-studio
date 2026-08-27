import { For } from 'solid-js';
import type { VisualScenarioDefinition, VisualScenarioId } from './scenarios';
import { CircleHelp, FileText, FolderOpen, History, Image, MessageSquare, MessagesSquare, PanelsTopLeft, Plus, Search, ShieldCheck, Sparkles, Workflow, Wrench } from 'lucide-solid';

function ScenarioIcon(props: { id: VisualScenarioId }) {
  const iconProps = { size: 18, strokeWidth: 1.7, 'aria-hidden': true } as const;
  switch (props.id) {
    case 'conversation': return <MessageSquare {...iconProps} />;
    case 'long-conversation': return <MessagesSquare {...iconProps} />;
    case 'markdown': return <FileText {...iconProps} />;
    case 'tools': return <Wrench {...iconProps} />;
    case 'permission-streaming': return <ShieldCheck {...iconProps} />;
    case 'elicitation': return <CircleHelp {...iconProps} />;
    case 'subtasks': return <Workflow {...iconProps} />;
    case 'resources': return <FolderOpen {...iconProps} />;
    case 'assets': return <Image {...iconProps} />;
    case 'terminal-readonly': return <History {...iconProps} />;
    case 'catalog': return <Sparkles {...iconProps} />;
    case 'design-tokens': return <PanelsTopLeft {...iconProps} />;
  }
}

export function VisualScenarioSidebar(props: { scenarios: readonly VisualScenarioDefinition[]; current: VisualScenarioId }) {
  return <aside class="visual-scenario-sidebar" aria-label="Design examples">
    <div class="visual-scenario-sidebar__actions">
      <a href="?scenario=catalog" class="visual-scenario-sidebar__new"><Plus size={18} strokeWidth={1.7} aria-hidden="true" /><strong>New example</strong></a>
      <a href="?scenario=conversation" class="visual-scenario-sidebar__search" aria-label="Open basic conversation"><Search size={18} strokeWidth={1.7} aria-hidden="true" /></a>
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
