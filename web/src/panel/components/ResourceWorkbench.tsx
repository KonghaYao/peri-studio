import { Show, createEffect, createMemo, createSignal, untrack } from 'solid-js';
import { Dialog, DialogContent, DialogTitle, Icon, IconButton } from '../../components/ui';
import { activateResourceProject, projectSessions, projects, refreshResourceProject, resourceWorkspace, selectedSessionId } from '../store';
import { ExplorerPanel } from './ExplorerPanel';
import { SourceControlPanel } from './SourceControlPanel';

export type WorkbenchView = 'explorer' | 'scm' | null;
export type ResourcePreviewOrigin = {
  view: Exclude<WorkbenchView, null>;
  key: string;
};
function FilesIcon() { return <Icon><path d="M4 3h8l4 4v10H4z" /><path d="M12 3v4h4M7 10h6M7 13h6" /></Icon>; }
function GitIcon() { return <Icon><circle cx="5" cy="4" r="1.5" /><circle cx="5" cy="16" r="1.5" /><circle cx="15" cy="7" r="1.5" /><path d="M5 5.5v9M6.5 13c5 0 8.5-1.5 8.5-4.5" /></Icon>; }
function RefreshIcon() { return <Icon size="small"><path d="M15.5 7A6 6 0 0 0 5 5.5L3.5 7M4.5 13A6 6 0 0 0 15 14.5l1.5-1.5" /><path d="M3.5 3.5V7h3.5M16.5 16.5V13H13" /></Icon>; }
function CloseIcon() { return <Icon size="small"><path d="m5 5 10 10M15 5 5 15" /></Icon>; }

type ResourceWorkbenchProps = {
  compact?: boolean;
  overlay?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  view?: WorkbenchView;
  onViewChange?: (view: WorkbenchView) => void;
  onPreviewIntent?: (origin: ResourcePreviewOrigin) => void;
  onCompactOpenAutoFocus?: (event: Event) => void;
  onCompactCloseAutoFocus?: (event: Event) => void;
};

export function ResourceWorkbench(props: ResourceWorkbenchProps = {}) {
  const [localView, setLocalView] = createSignal<WorkbenchView>('explorer');
  const [explorerExpanded, setExplorerExpanded] = createSignal(new Set<string>(['']));
  const [explorerActivePath, setExplorerActivePath] = createSignal('');
  const [explorerScrollTop, setExplorerScrollTop] = createSignal(0);
  const [commitMessages, setCommitMessages] = createSignal<Record<string, string>>({});
  const submittedCommits = new Map<string, { projectId: string; repoId: string; requestId: string; message: string }>();
  const view = () => props.view === undefined ? localView() : props.view;
  const setView = (next: WorkbenchView | ((current: WorkbenchView) => WorkbenchView)) => {
    const resolved = typeof next === 'function' ? next(view()) : next;
    if (props.view === undefined) setLocalView(resolved);
    props.onViewChange?.(resolved);
  };
  let wasOverlay = false;
  const project = createMemo(() => {
    const session = projectSessions().find((item) => item.id === selectedSessionId());
    return projects().find((item) => item.id === session?.projectId && !item.archivedAt)
      ?? projects().find((item) => !item.archivedAt)
      ?? null;
  });
  const activeProjectId = () => resourceWorkspace().projectId ?? project()?.id ?? '';
  const commitKey = (projectId: string, repoId: string) => `${projectId}\0${repoId}`;
  const visibleCommitMessages = createMemo(() => Object.fromEntries(resourceWorkspace().repositories.map((repo) => [
    repo.id,
    commitMessages()[commitKey(activeProjectId(), repo.id)] ?? '',
  ])));
  const setCommitMessage = (repoId: string, message: string) => {
    const projectId = activeProjectId();
    if (projectId) setCommitMessages((current) => ({ ...current, [commitKey(projectId, repoId)]: message }));
  };
  const recordSubmittedCommit = (repoId: string, requestId: string, message: string) => {
    const projectId = activeProjectId();
    if (projectId) submittedCommits.set(commitKey(projectId, repoId), { projectId, repoId, requestId, message });
  };
  createEffect(() => {
    const workspace = resourceWorkspace();
    for (const [key, submitted] of submittedCommits) {
      if (submitted.projectId !== workspace.projectId) {
        submittedCommits.delete(key);
        continue;
      }
      const current = workspace.repoMutations?.[submitted.repoId];
      if (current?.requestId === submitted.requestId) {
        if (!current.pending) submittedCommits.delete(key);
        continue;
      }
      // 另一个 mutation 取代精确请求时结果不明确，必须保留草稿。
      if (current) {
        submittedCommits.delete(key);
        continue;
      }
      setCommitMessages((messages) => {
        if ((messages[key] ?? '').trim() !== submitted.message) return messages;
        const next = { ...messages };
        delete next[key];
        return next;
      });
      submittedCommits.delete(key);
    }
  });
  createEffect(() => {
    const selected = project();
    if (selected && view() && (!props.compact || props.open)) {
      untrack(() => activateResourceProject(selected.id));
    }
  });
  createEffect(() => {
    if (props.compact && props.open && !view()) setView('explorer');
  });
  createEffect(() => {
    const overlay = !!props.overlay;
    if (overlay && !wasOverlay) setView(null);
    if (!overlay && wasOverlay && !view()) setView('explorer');
    wasOverlay = overlay;
  });
  const toggle = (next: Exclude<WorkbenchView, null>) => {
    if (props.compact) setView(next);
    else setView((current) => current === next ? null : next);
  };
  const close = () => props.compact ? props.onOpenChange?.(false) : setView(null);
  const surface = () => <aside class={`resource-workbench flex h-full min-h-0 border-l border-r border-divider bg-sidebar-bg ${props.compact ? 'absolute inset-0 w-full' : view() ? 'relative w-[46px] wide:w-[310px]' : 'relative w-[46px]'}`} aria-label="Workspace resources">
    <nav class="flex w-46 shrink-0 flex-col items-center border-r border-divider py-7" aria-label="Resource views">
      <ActivityButton label="Explorer" active={view() === 'explorer'} onClick={() => toggle('explorer')}><FilesIcon /></ActivityButton>
      <ActivityButton label="Source Control" active={view() === 'scm'} badge={resourceWorkspace().repositories.reduce((sum, repo) => sum + Object.values(repo.groups).reduce((count, group) => count + group.count, 0), 0)} onClick={() => toggle('scm')}><GitIcon /></ActivityButton>
    </nav>
    <Show when={view()}>
      <div class={`flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar-bg ${props.compact ? '' : 'desk:max-wide:absolute desk:max-wide:inset-y-0 desk:max-wide:left-46 desk:max-wide:z-30 desk:max-wide:w-[264px] desk:max-wide:border-r desk:max-wide:border-divider desk:max-wide:shadow-popover'}`}>
        <header class="flex h-40 shrink-0 items-center gap-5 border-b border-divider px-10">
          <strong class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-11 font-650 uppercase tracking-5 text-text-secondary">{project()?.name ?? 'Workspace'}</strong>
          <IconButton label="Refresh resources" onClick={refreshResourceProject} class="size-26 min-h-26 border-0 bg-transparent text-text-muted pointer-coarse:size-44 pointer-coarse:min-h-44"><RefreshIcon /></IconButton>
          <IconButton label="Close resource panel" onClick={close} class="size-26 min-h-26 border-0 bg-transparent text-text-muted pointer-coarse:size-44 pointer-coarse:min-h-44"><CloseIcon /></IconButton>
        </header>
        <Show when={project()} fallback={<div class="p-14 text-12 text-text-muted">Select or create a project to browse its workspace.</div>}>
          <Show when={resourceWorkspace().error}>{(message) => <div role="alert" class="m-8 flex items-start gap-6 rounded-6 border border-danger-border bg-danger-soft p-9 text-11 leading-16 text-danger">
            <span class="min-w-0 flex-1">{message()}</span>
            <button type="button" class="shrink-0 border-0 bg-transparent px-3 font-650 text-danger underline" onClick={refreshResourceProject}>Retry</button>
          </div>}</Show>
          <Show when={view() === 'explorer'}><ExplorerPanel expanded={explorerExpanded()} onExpandedChange={setExplorerExpanded} activePath={explorerActivePath()} onActivePathChange={setExplorerActivePath} scrollTop={explorerScrollTop()} onScrollTopChange={(scrollTop) => { if (!props.compact || props.open) setExplorerScrollTop(scrollTop); }} onPreviewIntent={(key) => props.onPreviewIntent?.({ view: 'explorer', key })} /></Show>
          <Show when={view() === 'scm'}><SourceControlPanel commitMessages={visibleCommitMessages()} onCommitMessageChange={setCommitMessage} onCommitSubmitted={recordSubmittedCommit} onPreviewIntent={(key) => props.onPreviewIntent?.({ view: 'scm', key })} /></Show>
        </Show>
      </div>
    </Show>
  </aside>;
  return <Show when={props.compact} fallback={surface()}>
    <Dialog open={!!props.open} onOpenChange={(open) => props.onOpenChange?.(open)}>
      <DialogContent
        class="top-0 right-0 bottom-22 left-auto h-auto max-h-none w-[min(92vw,360px)] translate-x-0 translate-y-0 overflow-hidden rounded-none border-y-0 border-r-0 p-0 pointer-coarse:bottom-44"
        onOpenAutoFocus={props.onCompactOpenAutoFocus}
        onCloseAutoFocus={props.onCompactCloseAutoFocus}
      >
        <DialogTitle class="sr-only">Workspace resources</DialogTitle>
        {surface()}
      </DialogContent>
    </Dialog>
  </Show>;
}

function ActivityButton(props: { label: string; active: boolean; badge?: number; onClick: () => void; children: unknown }) {
  return <button type="button" title={props.label} aria-label={props.label} aria-pressed={props.active} onClick={props.onClick} class={`relative grid size-38 place-items-center border-0 bg-transparent text-text-muted hover:text-text-primary pointer-coarse:size-44 ${props.active ? 'text-text-primary before:absolute before:top-5 before:bottom-5 before:left-[-4px] before:w-2 before:rounded-full before:bg-accent' : ''}`}>
    {props.children as never}<Show when={(props.badge ?? 0) > 0}><span class="absolute right-1 bottom-1 min-w-14 rounded-full bg-accent px-3 text-center text-9 leading-14 text-white">{props.badge! > 99 ? '99+' : props.badge}</span></Show>
  </button>;
}
