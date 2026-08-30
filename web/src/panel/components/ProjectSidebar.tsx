import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { archiveProject, archiveProjectSession, chatStatusSignal, createProject, createProjectSession, creatingSessionProjectId, discoverProjectSessions, discoveringSessionsProjectId, importableSessions, importProjectSession, instances, navigateProjectSession, openingSessionId, permissions, projects, projectSessions, registryHydrated, renameProject, renameProjectSession, restoreProject, restoreProjectSession, runtimeDocsHydrated, selectedCid, selectedSessionId, turnActive } from '../store';
import { isTerminal } from '../lib/action-state';
import { readOnly } from '../lib/auth-state';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Dialog, DialogContent, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, IconButton, LoadingState, TextField } from '../../components/ui';
import { SessionSearch } from './SessionSearch';
import { SessionImportDialog } from './SessionImportDialog';
import { ProjectSessionRow } from './ProjectSessionRow';
import { runConfirmedMutation } from '../lib/form-mutation';
import { pickProjectDirectory } from '../lib/pick-directory';
import { projectNameFromPath } from '../lib/project-path';
import { runtimeState } from '../lib/runtime-state.ts';
import { sessionDisplayTitle } from '../lib/recovery-state.ts';
import { selectActiveProjects } from '../lib/project-catalog';
import { ArchivedSection } from './shared/ArchivedSection';
import { ConfirmDialog } from './shared/ConfirmDialog';
import { SidebarChrome } from './SidebarChrome';
import { reconcileInstanceGroups, type InstanceGroup } from '../lib/instance-groups';
import { Archive, ChevronRight, Download, Folder, MoreHorizontal, Pencil, Plus } from 'lucide-solid';

function PlusIcon() { return <Plus size={17} strokeWidth={1.7} />; }
function ImportIcon() { return <Download size={16} strokeWidth={1.7} />; }
function ChevronIcon(props: { class?: string }) { return <ChevronRight size={16} strokeWidth={1.7} class={`flex-none text-text-muted ${props.class ?? ''}`} />; }
function MoreIcon() { return <MoreHorizontal size={17} strokeWidth={1.7} />; }
function FolderIcon() { return <Folder size={17} strokeWidth={1.7} />; }
function RenameIcon() { return <Pencil size={16} strokeWidth={1.7} />; }
function ArchiveIcon() { return <Archive size={16} strokeWidth={1.7} />; }

interface ProjectSidebarProps {
  onNavigate?: () => void;
  onOpenSystem?: () => void;
  intent?: { kind: 'create-project' | 'import'; projectId?: string; nonce: number } | null;
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  const [creating, setCreating] = createSignal(false);
  const [projectCreateSubmitting, setProjectCreateSubmitting] = createSignal(false);
  const [pickingDirectory, setPickingDirectory] = createSignal(false);
  const [pickDirectoryError, setPickDirectoryError] = createSignal<string | null>(null);
  const [cwd, setCwd] = createSignal('');
  const [editing, setEditing] = createSignal<string | null>(null);
  const [sessionMenu, setSessionMenu] = createSignal<string | null>(null);
  const [archiveSessionCandidate, setArchiveSessionCandidate] = createSignal<string | null>(null);
  const [sessionLifecycleBusy, setSessionLifecycleBusy] = createSignal<string | null>(null);
  const [archivedSessionsOpen, setArchivedSessionsOpen] = createSignal(new Set<string>());
  const [importingProject, setImportingProject] = createSignal<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = createSignal(new Set<string>());
  const [projectMenu, setProjectMenu] = createSignal<string | null>(null);
  const [archiveCandidate, setArchiveCandidate] = createSignal<string | null>(null);
  const [archiveSubmitting, setArchiveSubmitting] = createSignal(false);
  const [archivedOpen, setArchivedOpen] = createSignal(false);
  const [restoringProject, setRestoringProject] = createSignal<string | null>(null);
  const [renamingProject, setRenamingProject] = createSignal<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = createSignal('');
  const [projectRenameSubmitting, setProjectRenameSubmitting] = createSignal(false);
  const [searchOpen, setSearchOpen] = createSignal(false);
  let observedSelectedSessionId: string | null | undefined;
  const activeProjects = createMemo(() => selectActiveProjects(projects()));
  const sessionHasRunningRuntime = (session: { id: string; activeChatId?: string | null }) => {
    if (!session.activeChatId) return false;
    return session.id !== selectedSessionId() || !isTerminal(chatStatusSignal()[session.activeChatId]);
  };
  const projectHasRunningSession = (projectId: string) => projectSessions().some((session) => session.projectId === projectId && sessionHasRunningRuntime(session));
  const instanceGroups = createMemo<InstanceGroup[]>((previous = []) => reconcileInstanceGroups(
    instances(),
    activeProjects(),
    previous,
  ));
  const instanceIds = createMemo(() => instanceGroups().map((instance) => instance.id));
  const setProjectCollapsed = (projectId: string, collapsed: boolean) => setCollapsedProjects((current) => {
    const next = new Set(current);
    if (collapsed) next.add(projectId); else next.delete(projectId);
    return next;
  });
  const setArchivedSessionsExpanded = (projectId: string, open: boolean) => setArchivedSessionsOpen((current) => {
    const next = new Set(current);
    if (open) next.add(projectId); else next.delete(projectId);
    return next;
  });

  createEffect(() => {
    const intent = props.intent;
    if (!intent) return;
    if (intent.kind === 'create-project') setCreating(true);
    if (intent.kind === 'import' && intent.projectId) {
      setImportingProject(intent.projectId);
    }
  });

  onMount(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', shortcut);
    onCleanup(() => document.removeEventListener('keydown', shortcut));
  });

  createEffect(() => {
    const selectedId = selectedSessionId();
    if (selectedId === observedSelectedSessionId) return;
    observedSelectedSessionId = selectedId;
    if (!selectedId) return;
    const projectId = projectSessions().find((session) => session.id === selectedId)?.projectId;
    if (!projectId || !collapsedProjects().has(projectId)) return;
    setCollapsedProjects((current) => {
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
    queueMicrotask(() => document.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView?.({ block: 'nearest' }));
  });

  const submitProject = (e: SubmitEvent) => {
    e.preventDefault();
    const directory = cwd().trim();
    if (!directory || projectCreateSubmitting()) return;
    runConfirmedMutation(
      () => setProjectCreateSubmitting(true),
      () => setProjectCreateSubmitting(false),
      (committed, failed) => createProject(projectNameFromPath(directory), directory, committed, failed),
      () => { setCwd(''); setPickDirectoryError(null); setCreating(false); },
    );
  };

  const browseProjectDirectory = async () => {
    if (pickingDirectory() || projectCreateSubmitting()) return;
    setPickDirectoryError(null);
    setPickingDirectory(true);
    try {
      const result = await pickProjectDirectory();
      if (result.kind === 'selected') {
        setCwd(result.path);
        return;
      }
      if (result.kind === 'cancelled') return;
      if (result.kind === 'unauthorized') {
        setPickDirectoryError('Sign in again before choosing a folder.');
        return;
      }
      if (result.kind === 'unavailable') {
        setPickDirectoryError('Folder picker is not available on this machine.');
        return;
      }
      setPickDirectoryError('Could not open the folder picker. Try entering the path manually.');
    } finally {
      setPickingDirectory(false);
    }
  };

  return (
    <SidebarChrome onOpenSystem={props.onOpenSystem}>
      <SessionSearch open={searchOpen()} onClose={() => setSearchOpen(false)} onSelected={props.onNavigate} />
      <Show when={readOnly()}><div class="readonly-label -mt-8 mx-8 mb-12 text-11 font-semibold text-warning">Read-only mode</div></Show>
      <Dialog open={creating()} onOpenChange={(open) => { if (!open && !projectCreateSubmitting()) { setCreating(false); setPickDirectoryError(null); } }}><DialogContent dismissible={!projectCreateSubmitting() && !pickingDirectory()}><DialogTitle class="sr-only">New project</DialogTitle>
        <form class="m-0 rounded-12 border-0 bg-surface p-18 shadow-none" onSubmit={submitProject}>
          <div class="mb-9 flex flex-col gap-6">
            <label class="text-12 font-semibold text-text-secondary" for="project-directory">Working directory</label>
            <div class="flex items-center gap-6">
              <input
                id="project-directory"
                class="box-border h-38 min-w-0 flex-1 rounded-9 border border-border-strong bg-surface px-11 text-text-primary outline-none focus:border-focus-ring focus:shadow-[0_0_0_1px_var(--surface),0_0_0_3px_var(--focus-ring)] focus-visible:outline-0"
                value={cwd()}
                onInput={(e) => { setCwd(e.currentTarget.value); setPickDirectoryError(null); }}
                placeholder="/absolute/path"
                autofocus
              />
              <Button type="button" variant="secondary" class="shrink-0" busy={pickingDirectory()} disabled={projectCreateSubmitting()} onClick={() => { void browseProjectDirectory(); }}>Browse…</Button>
            </div>
            <Show when={cwd().trim()}><span class="text-11 text-text-muted">Project name: {projectNameFromPath(cwd())}</span></Show>
            <Show when={pickDirectoryError()}><span class="m-0 text-13 text-danger">{pickDirectoryError()}</span></Show>
          </div>
          <div class="mt-10 flex justify-end gap-6"><Button type="button" disabled={projectCreateSubmitting() || pickingDirectory()} onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" type="submit" busy={projectCreateSubmitting()} disabled={!cwd().trim() || pickingDirectory()}>Create</Button></div>
        </form>
      </DialogContent></Dialog>
      <div class="project-scroll ui-scrollbar min-h-0 flex-1 overflow-auto pt-4 pb-16">
        <Show
          when={registryHydrated()}
          fallback={<LoadingState label="Loading projects" class="sidebar-loading mx-8 p-8! text-left!" />}
        >
          <Show
            when={instanceGroups().length > 0}
            fallback={<EmptyState
              variant="inline"
              class="sidebar-empty mx-8 p-8! text-left!"
              title={projects().length ? 'No active projects' : 'No projects yet'}
              description={projects().length ? 'Restore an archived project to continue.' : 'No connected instances or projects are available.'}
            />}
          >
            <For each={instanceIds()}>{(instanceId) => {
              const instance = () => instanceGroups().find((item) => item.id === instanceId)!;
              return <section class="instance-group mb-10">
              <div class="instance-row group flex min-h-26 items-center gap-8 px-8 text-10 font-normal uppercase tracking-6 text-text-muted">
                <span class="instance-name min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{instance().name}</span>
                <Show when={instance().offline}><span class="instance-offline-dot size-7 shrink-0 rounded-full bg-danger" role="img" aria-label="Instance offline" /></Show>
                <IconButton class="new-project-button row-create-action instance-create-action ml-auto border-0 bg-transparent text-text-secondary opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100" label="New project" disabled={readOnly()} onClick={() => setCreating(true)}><PlusIcon /></IconButton>
              </div>
              <For each={instance().projects.map((project) => project.id)}>{(projectId) => {
            const project = () => instance().projects.find((item) => item.id === projectId)!;
            const sessions = () => projectSessions().filter((s) => s.projectId === projectId && !s.archivedAt);
            const archivedSessions = () => projectSessions().filter((s) => s.projectId === projectId && !!s.archivedAt);
            const collapsed = () => collapsedProjects().has(projectId);
            const projectMenuId = `project-menu-${projectId}`;
            return <Collapsible as="section" class="project-group" open={!collapsed()} onOpenChange={(open) => setProjectCollapsed(projectId, !open)}>
              <div class="project-heading group flex min-h-36 items-center rounded-8 hover:bg-hover focus-within:bg-hover pointer-coarse:min-h-52">
                <CollapsibleTrigger class="project-disclosure group/disclosure flex min-h-36 min-w-0 flex-1 items-center gap-7 rounded-8 border-0 bg-transparent px-8 text-left text-13 font-normal text-text-primary cursor-pointer pointer-coarse:min-h-44"><ChevronIcon class="size-12! rotate-0 transition-transform duration-150 group-data-[expanded]/disclosure:rotate-90" /><FolderIcon /><span class="block overflow-hidden text-ellipsis whitespace-nowrap">{project().name}</span></CollapsibleTrigger>
                <IconButton class="row-create-action ml-auto border-0 bg-transparent text-text-secondary opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100" tooltipPlacement="end" label={`New session in ${project().name}`} busy={creatingSessionProjectId() === projectId} disabled={readOnly() || !!creatingSessionProjectId()} onClick={() => createProjectSession(projectId)}><PlusIcon /></IconButton>
                <DropdownMenu open={projectMenu() === projectId} onOpenChange={(open) => setProjectMenu(open ? projectId : null)} placement="bottom-end">
                  <DropdownMenuTrigger as={IconButton} class="project-menu-trigger border-0 bg-transparent text-text-secondary opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100" tooltipPlacement="end" label={`${project().name} actions`} disabled={readOnly()}><MoreIcon /></DropdownMenuTrigger>
                  <DropdownMenuContent id={projectMenuId} aria-label={`${project().name} actions`} class="ui-menu">
                    <DropdownMenuItem onSelect={() => { setProjectNameDraft(project().name); setRenamingProject(projectId); }}><RenameIcon />Rename project</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setImportingProject(projectId)}><ImportIcon />Import existing session</DropdownMenuItem>
                    <DropdownMenuItem class="text-danger focus:text-danger" disabled={projectHasRunningSession(projectId)} title={projectHasRunningSession(projectId) ? 'Close the running sessions in this project first' : undefined} onSelect={() => setArchiveCandidate(projectId)}><ArchiveIcon />Archive project</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <CollapsibleContent id={`project-sessions-${projectId}`} class="session-list flex flex-col pl-16">
                <For each={sessions()} fallback={<Button busy={creatingSessionProjectId() === projectId} disabled={readOnly() || !!creatingSessionProjectId()} class="session-empty mx-8 cursor-pointer rounded-8 p-8 text-left text-12 text-text-muted hover:bg-hover hover:text-text-secondary" onClick={() => createProjectSession(projectId)}>Start your first conversation</Button>}>
                  {(session) => {
                    const selected = () => selectedSessionId() === session.id;
                    const state = () => runtimeState({
                      hasSession: true,
                      lifecycle: session.lifecycle,
                      isOpening: openingSessionId() === session.id,
                      hasRuntime: !!session.activeChatId,
                      isSelected: selected(),
                      isHydrated: selected() ? runtimeDocsHydrated() : undefined,
                      chatStatus: selected() ? chatStatusSignal()[selectedCid() ?? ''] : null,
                      hasPendingPermission: selected() && permissions().some((permission) => permission.status === 'pending'),
                      turnActive: selected() && turnActive(),
                    });
                    return <ProjectSessionRow
                      session={session}
                      state={state()}
                      selected={selected()}
                      navigationBusy={!!openingSessionId()}
                      readOnly={readOnly()}
                      renameOpen={editing() === session.id}
                      menuOpen={sessionMenu() === session.id}
                      runtimeActive={sessionHasRunningRuntime(session)}
                      replacementBusy={creatingSessionProjectId() === projectId}
                      onNavigate={() => props.onNavigate?.()}
                      onOpen={(sessionId, onCommitted) => { navigateProjectSession(sessionId, { onCommitted }); }}
                      onSelectRuntime={(sessionId) => { navigateProjectSession(sessionId); }}
                      onRenameOpenChange={(open) => setEditing(open ? session.id : null)}
                      onMenuOpenChange={(open) => setSessionMenu(open ? session.id : null)}
                      onRename={renameProjectSession}
                      onCreateReplacement={(title) => { createProjectSession(projectId, title); }}
                      onArchiveRequest={setArchiveSessionCandidate}
                    />;
                  }}
                </For>
                <Show when={archivedSessions().length > 0}>
                  <ArchivedSection
                    toggleClass="archived-sessions__toggle flex w-full min-h-34 cursor-pointer items-center gap-6 mt-4 rounded-8 border-0 bg-transparent px-8 text-left text-11 text-text-muted hover:bg-hover hover:text-text-secondary pointer-coarse:min-h-44"
                    label="Archived sessions"
                    count={archivedSessions().length}
                    open={archivedSessionsOpen().has(projectId)}
                    onOpenChange={(open) => setArchivedSessionsExpanded(projectId, open)}
                    listId={`archived-sessions-${projectId}`}
                    listClass="archived-session-list flex flex-col gap-2 pt-2 pr-3 pb-5 pl-16"
                  >
                    <For each={archivedSessions()}>{(session) => <div class="archived-session-row flex min-h-42 items-center gap-8 rounded-8 py-3 pr-4 pl-8 hover:bg-hover"><span class="flex min-w-0 flex-1 flex-col gap-2"><strong class="overflow-hidden text-ellipsis whitespace-nowrap text-12 font-550">{sessionDisplayTitle(session.title, session.id)}</strong><small class="text-10 text-text-muted">{session.lifecycle === 'ready' ? 'Session saved' : session.lifecycle}</small></span><Button size="compact" class="min-h-30! px-8! text-11! pointer-coarse:min-h-44!" busy={sessionLifecycleBusy() === session.id} disabled={readOnly() || !!sessionLifecycleBusy()} onClick={() => runConfirmedMutation(() => setSessionLifecycleBusy(session.id), () => setSessionLifecycleBusy(null), (committed, failed) => restoreProjectSession(session.id, committed, failed), () => {})}>Restore</Button></div>}</For>
                  </ArchivedSection>
                </Show>
              </CollapsibleContent>
            </Collapsible>;
              }}</For>
            </section>;
            }}</For>
          </Show>
        </Show>
      </div>
      <Show when={registryHydrated() && projects().some((project) => !!project.archivedAt)}>
        <section class="archived-projects mx-2 mb-8 border-t border-divider pt-7">
          <ArchivedSection
            toggleClass="archived-projects__toggle flex w-full min-h-34 cursor-pointer items-center gap-6 rounded-8 border-0 bg-transparent px-7 text-left text-11 text-text-muted hover:bg-hover hover:text-text-secondary pointer-coarse:min-h-44"
            label="Archived"
            count={projects().filter((project) => !!project.archivedAt).length}
            open={archivedOpen()}
            onOpenChange={setArchivedOpen}
            listId="archived-project-list"
            listClass="archived-project-list flex max-h-180 flex-col gap-2 overflow-auto p-3"
          >
            <For each={projects().filter((project) => !!project.archivedAt)}>{(project) => <div class="archived-project-row flex min-h-46 items-center gap-8 rounded-8 py-4 pr-5 pl-9 hover:bg-hover"><span class="flex min-w-0 flex-1 flex-col gap-2"><strong class="overflow-hidden text-ellipsis whitespace-nowrap text-12 font-550">{project.name}</strong><small class="text-10 text-text-muted">{projectSessions().filter((session) => session.projectId === project.id).length} sessions</small></span><Button class="min-h-30! px-8! text-11! pointer-coarse:min-h-44!" busy={restoringProject() === project.id} disabled={readOnly() || !!restoringProject()} onClick={() => runConfirmedMutation(() => setRestoringProject(project.id), () => setRestoringProject(null), (committed, failed) => restoreProject(project.id, committed, failed), () => {})}>Restore</Button></div>}</For>
          </ArchivedSection>
        </section>
      </Show>
      <SessionImportDialog
        open={!!importingProject()}
        project={projects().find((item) => item.id === importingProject()) || null}
        sessions={importableSessions()}
        discovering={discoveringSessionsProjectId() === importingProject()}
        onDiscover={discoverProjectSessions}
        onClose={() => setImportingProject(null)}
        onImport={importProjectSession}
      />
      <Dialog open={!!renamingProject()} onOpenChange={(open) => { if (!open && !projectRenameSubmitting()) setRenamingProject(null); }}><DialogContent dismissible={!projectRenameSubmitting()}><DialogTitle class="sr-only">Rename project</DialogTitle>
        <form class="m-0 rounded-12 border-0 bg-surface p-18 shadow-none" onSubmit={(event) => { event.preventDefault(); const id = renamingProject(); if (!id || !projectNameDraft().trim()) return; runConfirmedMutation(() => setProjectRenameSubmitting(true), () => setProjectRenameSubmitting(false), (committed, failed) => renameProject(id, projectNameDraft(), committed, failed), () => setRenamingProject(null)); }}>
          <TextField label="Project name" value={projectNameDraft()} onInput={(event) => setProjectNameDraft(event.currentTarget.value)} autofocus />
          <p class="mt-2 text-11 leading-15 text-text-muted">Only renames the sidebar entry; the working directory and ACP session are unchanged.</p>
          <div class="mt-10 flex justify-end gap-6"><Button disabled={projectRenameSubmitting()} onClick={() => setRenamingProject(null)}>Cancel</Button><Button variant="primary" type="submit" busy={projectRenameSubmitting()} disabled={!projectNameDraft().trim()}>Save</Button></div>
        </form>
      </DialogContent></Dialog>
      <Dialog open={!!archiveCandidate()} onOpenChange={(open) => { if (!open && !archiveSubmitting()) setArchiveCandidate(null); }}><DialogContent dismissible={!archiveSubmitting()}><DialogTitle class="sr-only">Archive project</DialogTitle>
        {(() => {
          const project = () => projects().find((item) => item.id === archiveCandidate());
          const count = () => projectSessions().filter((session) => session.projectId === archiveCandidate()).length;
          const running = () => !!archiveCandidate() && projectHasRunningSession(archiveCandidate()!);
          return <ConfirmDialog
            eyebrow="Project management"
            title={`Archive “${project()?.name}”?`}
            description={<>The project will be hidden from the sidebar; its {count()} saved sessions will not be deleted. No files in the working directory are touched.</>}
            warning={running() ? 'This project still has running instances. Close the running instances from each session menu before archiving.' : undefined}
            cancelDisabled={archiveSubmitting()}
            confirmLabel="Archive project"
            confirmDisabled={running()}
            confirmBusy={archiveSubmitting()}
            onCancel={() => setArchiveCandidate(null)}
            onConfirm={() => { const id = archiveCandidate(); if (!id) return; runConfirmedMutation(() => setArchiveSubmitting(true), () => setArchiveSubmitting(false), (committed, failed) => archiveProject(id, committed, failed), () => setArchiveCandidate(null)); }}
          />;
        })()}
      </DialogContent></Dialog>
      <Dialog open={!!archiveSessionCandidate()} onOpenChange={(open) => { if (!open && !sessionLifecycleBusy()) setArchiveSessionCandidate(null); }}><DialogContent dismissible={!sessionLifecycleBusy()}><DialogTitle class="sr-only">Archive session</DialogTitle>
        {(() => {
          const session = () => projectSessions().find((item) => item.id === archiveSessionCandidate());
          const displayTitle = () => sessionDisplayTitle(session()?.title, session()?.id);
          const running = () => !!session() && sessionHasRunningRuntime(session()!);
          return <ConfirmDialog
            eyebrow="Session cleanup"
            title={`Archive “${displayTitle()}”?`}
            description="The session will be hidden from the current project list, but the ACP thread, message history, and local project files are not deleted. You can restore it later under “Archived sessions”."
            warning={running() ? 'This session still has a running instance. Close the running instance from the menu at the top of the session first.' : undefined}
            cancelDisabled={!!sessionLifecycleBusy()}
            confirmLabel="Archive session"
            confirmDisabled={running()}
            confirmBusy={!!sessionLifecycleBusy()}
            onCancel={() => setArchiveSessionCandidate(null)}
            onConfirm={() => { const id = archiveSessionCandidate(); if (!id) return; runConfirmedMutation(() => setSessionLifecycleBusy(id), () => setSessionLifecycleBusy(null), (committed, failed) => archiveProjectSession(id, committed, failed), () => setArchiveSessionCandidate(null)); }}
          />;
        })()}
      </DialogContent></Dialog>
    </SidebarChrome>
  );
}
