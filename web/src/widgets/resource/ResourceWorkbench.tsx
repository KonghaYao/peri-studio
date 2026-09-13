import { Show, createEffect, createMemo, createSignal, untrack, type JSX } from 'solid-js';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  WorkbenchPanelChrome,
  WorkbenchRail,
  InlineNotice,
  WorkbenchShell,
  cn,
  terminalDockParkedSurfaceClass,
  workbenchPanelSurfaceClass,
} from '@peri/ui';
import {
  activateResourceProject,
  projectSessions,
  projects,
  refreshResourceProject,
  resourceWorkspace,
  selectedSessionId,
} from '@/store';
import { refreshGitLog } from '@/store';
import { ExplorerPanel } from './ExplorerPanel';
import { SourceControlPanel } from './SourceControlPanel';
import { McpPanelContent } from '@/widgets/chat/McpPanel';
import { ResourceRailButton } from './ResourceRailButton';
import { SessionRailActions } from '@/widgets/shell/SessionRailActions';
import { Files, GitBranch, GitGraph, PlugZap, RefreshCw, SquareTerminal, X } from 'lucide-solid';
import { TerminalPanel } from '@/widgets/terminal/TerminalPanel';
import { terminalSession } from '@/features/terminal/terminal-session';
import { ResourceFloatingPanel } from './ResourceFloatingPanel';
import { GitGraphView } from './git/GitGraphView';
import { resourceWorkbenchRequest } from '@/store';

export type WorkbenchView = 'explorer' | 'scm' | 'mcp' | 'graph' | 'terminal' | null;
export type ResourcePreviewOrigin = {
  view: 'explorer' | 'scm';
  key: string;
};

type ResourceWorkbenchProps = {
  compact?: boolean;
  autoCollapse?: boolean;
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
  createEffect(() => {
    const request = resourceWorkbenchRequest();
    if (!request?.activePath) return;
    setExplorerActivePath(request.activePath);
    setExplorerExpanded((current) => {
      const next = new Set(current);
      const parts = request.activePath!.split('/').filter(Boolean);
      let prefix = '';
      for (const part of parts.slice(0, -1)) {
        prefix = prefix ? `${prefix}/${part}` : part;
        next.add(prefix);
      }
      next.add('');
      return next;
    });
  });
  const [commitMessages, setCommitMessages] = createSignal<Record<string, string>>({});
  const [explorerToolbar, setExplorerToolbar] = createSignal<JSX.Element>();
  const submittedCommits = new Map<string, { projectId: string; repoId: string; requestId: string; message: string }>();
  const view = () => props.view === undefined ? localView() : props.view;
  const setView = (next: WorkbenchView | ((current: WorkbenchView) => WorkbenchView)) => {
    const resolved = typeof next === 'function' ? next(view()) : next;
    if (props.view === undefined) setLocalView(resolved);
    props.onViewChange?.(resolved);
  };
  let wasAutoCollapsed = false;
  const project = createMemo(() => {
    const session = projectSessions().find((item) => item.id === selectedSessionId());
    return projects().find((item) => item.id === session?.projectId && !item.archivedAt)
      ?? projects().find((item) => !item.archivedAt)
      ?? null;
  });
  const activeProjectId = () => resourceWorkspace().projectId ?? project()?.id ?? '';
  const sourceControlCount = createMemo(() => resourceWorkspace().repositories.reduce((repoTotal, repo) => (
    repoTotal + Object.values(repo.groups).reduce((groupTotal, group) => groupTotal + group.count, 0)
  ), 0));
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
    if (selected && (view() === 'explorer' || view() === 'scm' || view() === 'graph') && (!props.compact || props.open)) {
      untrack(() => activateResourceProject(selected.id));
    }
  });
  createEffect(() => {
    if (props.compact && props.open && !view()) setView('explorer');
  });
  createEffect(() => {
    const autoCollapse = !!props.autoCollapse;
    if (autoCollapse && !wasAutoCollapsed) setView(null);
    if (!autoCollapse && wasAutoCollapsed && !view()) setView('explorer');
    wasAutoCollapsed = autoCollapse;
  });
  createEffect(() => {
    if (view() !== 'explorer') setExplorerToolbar(undefined);
  });
  const toggle = (next: Exclude<WorkbenchView, null>) => {
    if (props.compact) setView(next);
    else setView((current) => current === next ? null : next);
  };
  const close = () => props.compact ? props.onOpenChange?.(false) : setView(null);
  const panelTitle = () => {
    if (view() === 'explorer') return 'Explorer';
    if (view() === 'scm') return 'Source Control';
    if (view() === 'mcp') return 'MCP';
    if (view() === 'graph') return 'Git Graph';
    if (view() === 'terminal') return 'Terminal';
    return project()?.name ?? 'Workspace';
  };
  const panelWidthProfile = () => {
    if (view() === 'graph') return 'graph' as const;
    if (view() === 'terminal') return 'terminal' as const;
    return 'workspace' as const;
  };
  const terminalRailBadge = () => {
    const phase = terminalSession().phase;
    return phase === 'running' || phase === 'opening' ? 1 : 0;
  };
  const terminalPanelVisible = () => {
    if (!showPanel() || view() !== 'terminal') return false;
    if (props.compact && !props.open) return false;
    return true;
  };
  const holdTerminalSurface = () => {
    if (terminalPanelVisible()) return true;
    const phase = terminalSession().phase;
    return phase === 'opening' || phase === 'running';
  };
  const terminalSurfaceParked = () => holdTerminalSurface() && !terminalPanelVisible();
  const showPanel = () => !!view();
  const panelSurfaceClass = workbenchPanelSurfaceClass;
  const terminalParkedClass = terminalDockParkedSurfaceClass;
  const panelHeaderActions = () => (
    <>
      <Show when={view() === 'explorer'}>{explorerToolbar()}</Show>
      <Show when={view() === 'explorer' || view() === 'scm'}>
        <IconButton label="Refresh resources" size="compact" onClick={refreshResourceProject} class="border-0 bg-transparent text-content-muted hover:text-content-primary">
          <RefreshCw size={14} strokeWidth={1.7} />
        </IconButton>
      </Show>
      <Show when={view() === 'graph'}>
        <IconButton
          label="Refresh graph"
          size="compact"
          onClick={() => {
            const repo = resourceWorkspace().repositories[0];
            if (repo) refreshGitLog(repo.id);
          }}
          class="border-0 bg-transparent text-content-muted hover:text-content-primary"
        >
          <RefreshCw size={14} strokeWidth={1.7} />
        </IconButton>
      </Show>
      <IconButton label="Close resource panel" size="compact" onClick={close} class="border-0 bg-transparent text-content-muted hover:text-content-primary">
        <X size={14} strokeWidth={1.7} />
      </IconButton>
    </>
  );
  const PanelBody = () => (
    <Show when={view() !== 'terminal'}>
      <WorkbenchPanelChrome title={<strong>{panelTitle()}</strong>} actions={panelHeaderActions()}>
        <Show when={view() === 'mcp'}><McpPanelContent embedded /></Show>
        <Show when={view() === 'graph'}>
          <GitGraphView embedded />
        </Show>
        <Show when={view() === 'explorer' || view() === 'scm'}>
          <Show when={project()} fallback={<div class="p-16 text-12 text-content-muted">Select or create a project to browse its workspace.</div>}>
            <Show when={resourceWorkspace().error}>{(message) => <InlineNotice tone="danger" class="m-8 items-center gap-6 py-9 text-11 leading-16" role="alert">
              <div class="flex min-w-0 flex-1 items-center gap-6">
                <span class="min-w-0 flex-1">{message()}</span>
                <Button size="compact" variant="ghost" class="shrink-0 border-0! bg-transparent! px-3 font-650 text-danger underline pointer-coarse:min-h-44 pointer-coarse:px-8" onClick={refreshResourceProject}>Retry</Button>
              </div>
            </InlineNotice>}</Show>
            <Show when={view() === 'explorer'}><ExplorerPanel embedded onEmbeddedToolbarChange={setExplorerToolbar} expanded={explorerExpanded()} onExpandedChange={setExplorerExpanded} activePath={explorerActivePath()} onActivePathChange={setExplorerActivePath} scrollTop={explorerScrollTop()} onScrollTopChange={(scrollTop) => { if (!props.compact || props.open) setExplorerScrollTop(scrollTop); }} onPreviewIntent={(key) => props.onPreviewIntent?.({ view: 'explorer', key })} /></Show>
            <Show when={view() === 'scm'}><SourceControlPanel embedded commitMessages={visibleCommitMessages()} onCommitMessageChange={setCommitMessage} onCommitSubmitted={recordSubmittedCommit} onPreviewIntent={(key) => props.onPreviewIntent?.({ view: 'scm', key })} /></Show>
          </Show>
        </Show>
      </WorkbenchPanelChrome>
    </Show>
  );
  const rail = () => (
    <WorkbenchRail>
      <ResourceRailButton label="Explorer" active={view() === 'explorer'} onClick={() => toggle('explorer')}><Files size={17} strokeWidth={1.7} /></ResourceRailButton>
      <ResourceRailButton label="Source Control" active={view() === 'scm'} badge={sourceControlCount()} onClick={() => toggle('scm')}><GitBranch size={17} strokeWidth={1.7} /></ResourceRailButton>
      <ResourceRailButton label="MCP" active={view() === 'mcp'} onClick={() => toggle('mcp')}><PlugZap size={17} strokeWidth={1.7} /></ResourceRailButton>
      <ResourceRailButton label="Git Graph" active={view() === 'graph'} onClick={() => toggle('graph')}><GitGraph size={17} strokeWidth={1.7} /></ResourceRailButton>
      <ResourceRailButton label="Terminal" active={view() === 'terminal'} badge={terminalRailBadge()} onClick={() => toggle('terminal')}><SquareTerminal size={17} strokeWidth={1.7} /></ResourceRailButton>
      <SessionRailActions />
    </WorkbenchRail>
  );
  const surface = () => (
    <WorkbenchShell compact={props.compact} rail={rail()}>
      <Show when={!props.compact && holdTerminalSurface()}>
        <ResourceFloatingPanel
          data-testid="terminal-floating-panel"
          class={cn(panelSurfaceClass, terminalSurfaceParked() && terminalParkedClass)}
          widthProfile="terminal"
        >
          <TerminalPanel onClosePanel={close} visible={terminalPanelVisible()} />
        </ResourceFloatingPanel>
      </Show>
      <Show when={showPanel()}>
        <Show when={props.compact} fallback={
          <Show when={view() !== 'terminal'}>
            <ResourceFloatingPanel
              data-testid="resource-workbench-panel"
              class={panelSurfaceClass}
              widthProfile={panelWidthProfile()}
            >
              <PanelBody />
            </ResourceFloatingPanel>
          </Show>
        }>
          <div data-testid="resource-workbench-panel" class={panelSurfaceClass}>
            <Show when={terminalPanelVisible()}>
              <TerminalPanel onClosePanel={close} visible={true} />
            </Show>
            <Show when={view() !== 'terminal'}><PanelBody /></Show>
          </div>
        </Show>
      </Show>
    </WorkbenchShell>
  );
  return <>
    <Show when={props.compact} fallback={surface()}>
      <Dialog open={!!props.open} onOpenChange={(open) => props.onOpenChange?.(open)}>
        <DialogContent
          size="resource-compact"
          onOpenAutoFocus={props.onCompactOpenAutoFocus}
          onCloseAutoFocus={props.onCompactCloseAutoFocus}
        >
          <DialogTitle class="sr-only">Workspace resources</DialogTitle>
          {surface()}
        </DialogContent>
      </Dialog>
    </Show>
    <Show when={props.compact && terminalSurfaceParked()}>
      <div data-testid="terminal-parked-panel" class={cn(panelSurfaceClass, terminalParkedClass)}>
        <TerminalPanel onClosePanel={close} visible={false} />
      </div>
    </Show>
  </>;
}
