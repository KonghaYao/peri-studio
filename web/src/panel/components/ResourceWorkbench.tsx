import { Show, createEffect, createMemo, createSignal, untrack } from 'solid-js';
import { Icon, IconButton } from '../../components/ui';
import { activateResourceProject, projectSessions, projects, refreshResourceProject, resourceWorkspace, selectedSessionId } from '../store';
import { ExplorerPanel } from './ExplorerPanel';
import { SourceControlPanel } from './SourceControlPanel';

type WorkbenchView = 'explorer' | 'scm' | null;
function FilesIcon() { return <Icon><path d="M4 3h8l4 4v10H4z" /><path d="M12 3v4h4M7 10h6M7 13h6" /></Icon>; }
function GitIcon() { return <Icon><circle cx="5" cy="4" r="1.5" /><circle cx="5" cy="16" r="1.5" /><circle cx="15" cy="7" r="1.5" /><path d="M5 5.5v9M6.5 13c5 0 8.5-1.5 8.5-4.5" /></Icon>; }
function RefreshIcon() { return <Icon size="small"><path d="M15.5 7A6 6 0 0 0 5 5.5L3.5 7M4.5 13A6 6 0 0 0 15 14.5l1.5-1.5" /><path d="M3.5 3.5V7h3.5M16.5 16.5V13H13" /></Icon>; }
function CloseIcon() { return <Icon size="small"><path d="m5 5 10 10M15 5 5 15" /></Icon>; }

export function ResourceWorkbench() {
  const [view, setView] = createSignal<WorkbenchView>('explorer');
  const project = createMemo(() => {
    const session = projectSessions().find((item) => item.id === selectedSessionId());
    return projects().find((item) => item.id === session?.projectId && !item.archivedAt)
      ?? projects().find((item) => !item.archivedAt)
      ?? null;
  });
  createEffect(() => {
    const selected = project();
    if (selected && view()) untrack(() => activateResourceProject(selected.id));
  });
  const toggle = (next: Exclude<WorkbenchView, null>) => setView((current) => current === next ? null : next);
  return <aside class="resource-workbench max-desk:hidden flex h-full min-h-0 border-l border-r border-divider bg-sidebar-bg" style={{ width: view() ? '310px' : '46px' }} aria-label="Workspace resources">
    <nav class="flex w-46 shrink-0 flex-col items-center border-r border-divider py-7" aria-label="Resource views">
      <ActivityButton label="Explorer" active={view() === 'explorer'} onClick={() => toggle('explorer')}><FilesIcon /></ActivityButton>
      <ActivityButton label="Source Control" active={view() === 'scm'} badge={resourceWorkspace().repositories.reduce((sum, repo) => sum + Object.values(repo.groups).reduce((count, group) => count + group.count, 0), 0)} onClick={() => toggle('scm')}><GitIcon /></ActivityButton>
    </nav>
    <Show when={view()}>
      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex h-40 shrink-0 items-center gap-5 border-b border-divider px-10">
          <strong class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-11 font-650 uppercase tracking-5 text-text-secondary">{project()?.name ?? 'Workspace'}</strong>
          <IconButton label="Refresh resources" onClick={refreshResourceProject} class="size-26 min-h-26 border-0 bg-transparent text-text-muted"><RefreshIcon /></IconButton>
          <IconButton label="Close resource panel" onClick={() => setView(null)} class="size-26 min-h-26 border-0 bg-transparent text-text-muted"><CloseIcon /></IconButton>
        </header>
        <Show when={project()} fallback={<div class="p-14 text-12 text-text-muted">Select or create a project to browse its workspace.</div>}>
          <Show when={!resourceWorkspace().error} fallback={<div class="m-8 rounded-6 border border-danger-border bg-danger-soft p-9 text-11 leading-16 text-danger">{resourceWorkspace().error}</div>}>
            <Show when={view() === 'explorer'}><ExplorerPanel /></Show>
            <Show when={view() === 'scm'}><SourceControlPanel /></Show>
          </Show>
        </Show>
      </div>
    </Show>
  </aside>;
}

function ActivityButton(props: { label: string; active: boolean; badge?: number; onClick: () => void; children: unknown }) {
  return <button type="button" title={props.label} aria-label={props.label} aria-pressed={props.active} onClick={props.onClick} class={`relative grid size-38 place-items-center border-0 bg-transparent text-text-muted hover:text-text-primary ${props.active ? 'text-text-primary before:absolute before:top-5 before:bottom-5 before:left-[-4px] before:w-2 before:rounded-full before:bg-accent' : ''}`}>
    {props.children as never}<Show when={(props.badge ?? 0) > 0}><span class="absolute right-1 bottom-1 min-w-14 rounded-full bg-accent px-3 text-center text-9 leading-14 text-white">{props.badge! > 99 ? '99+' : props.badge}</span></Show>
  </button>;
}
