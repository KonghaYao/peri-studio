import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import {
  archiveProject,
  archiveProjectSession,
  chatStatusSignal,
  createProject,
  createProjectSession,
  creatingSessionProjectId,
  discoverProjectSessions,
  discoveringSessionsProjectId,
  importableSessions,
  importProjectSession,
  instances,
  isProjectCatalogBootstrapPending,
  navigateProjectSession,
  openingSessionId,
  permissions,
  projects,
  projectSessions,
  registryHydrated,
  renameProject,
  renameProjectSession,
  restoreProject,
  restoreProjectSession,
  runtimeDocsHydrated,
  selectedCid,
  selectedSessionId,
  turnActive,
} from '../../panel/store';
import { isTerminal } from '../../panel/lib/action-state';
import { principalId, readOnly } from '../../panel/lib/auth-state';
import {
  Button,
  buttonGroupItemClass,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  LoadingState,
  TextField,
} from '@/shared/ui';
import { SessionSearch } from './SessionSearch';
import { ArchivedBrowserDialog } from './ArchivedBrowserDialog';
import { SessionImportDialog } from '@/widgets/shell/SessionImportDialog';
import { ProjectSessionRow } from './ProjectSessionRow';
import { NavAction, ProjectRowAccessory, ProjectRowActionGroup, SectionHeader } from './sidebar-parts';
import { runConfirmedMutation } from '../../panel/lib/form-mutation';
import { pickProjectDirectory } from '../../panel/lib/pick-directory';
import { projectNameFromPath } from '../../panel/lib/project-path';
import { runtimeState } from '../../panel/lib/runtime-state.ts';
import { sessionDisplayTitle } from '../../panel/lib/recovery-state.ts';
import { selectActiveProjects } from '../../features/catalog/project-catalog';
import type { ProjectSessionInfo } from '@/entities/registry/registry-view';
import {
  readPinnedSessions,
  selectPinnedSessions,
  togglePinnedSession,
  writePinnedSessions,
  type SessionPin,
} from '@/features/session/session-pins';
import { ConfirmDialog } from '@/widgets/shell/shared/ConfirmDialog';
import { ArchivedSection } from '@/widgets/shell/shared/ArchivedSection';
import { SidebarChrome } from '@/widgets/shell/SidebarChrome';
import { reconcileInstanceGroups, type InstanceGroup } from '../../panel/lib/instance-groups';
import {
  Archive,
  CloudOff,
  Download,
  Folder,
  FolderOpen,
  ListFilter,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
} from 'lucide-solid';

function PlusIcon() { return <Plus size={15} strokeWidth={1.7} />; }
function ImportIcon() { return <Download size={16} strokeWidth={1.7} />; }
function MoreIcon() { return <MoreHorizontal size={14} strokeWidth={1.7} />; }
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
  const [importingProject, setImportingProject] = createSignal<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = createSignal(new Set<string>());
  const [projectMenu, setProjectMenu] = createSignal<string | null>(null);
  const [archiveCandidate, setArchiveCandidate] = createSignal<string | null>(null);
  const [archiveSubmitting, setArchiveSubmitting] = createSignal(false);
  const [archivedBrowserProjectId, setArchivedBrowserProjectId] = createSignal<string | null>(null);
  const [archivedOpen, setArchivedOpen] = createSignal(false);
  const [restoringProject, setRestoringProject] = createSignal<string | null>(null);
  const [renamingProject, setRenamingProject] = createSignal<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = createSignal('');
  const [projectRenameSubmitting, setProjectRenameSubmitting] = createSignal(false);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [pinnedSessionKeys, setPinnedSessionKeys] = createSignal<SessionPin[]>([]);
  let observedSelectedSessionId: string | null | undefined;
  const activeProjects = createMemo(() => selectActiveProjects(projects()));
  const pinnedSessions = createMemo(() => selectPinnedSessions(
    projectSessions().filter((session) => !session.archivedAt),
    pinnedSessionKeys(),
  ));
  const archivedBrowserProject = () => {
    const projectId = archivedBrowserProjectId();
    if (!projectId) return null;
    return projects().find((item) => item.id === projectId) ?? null;
  };
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
  const defaultProjectId = () => {
    const selected = selectedSessionId();
    if (selected) {
      const projectId = projectSessions().find((session) => session.id === selected)?.projectId;
      if (projectId) return projectId;
    }
    return activeProjects()[0]?.id ?? null;
  };
  const setProjectCollapsed = (projectId: string, collapsed: boolean) => setCollapsedProjects((current) => {
    const next = new Set(current);
    if (collapsed) next.add(projectId); else next.delete(projectId);
    return next;
  });
  const isSessionPinned = (session: Pick<ProjectSessionInfo, 'projectId' | 'id'>): boolean =>
    pinnedSessionKeys().some((pin) => pin.projectId === session.projectId && pin.sessionId === session.id);
  const toggleSessionPin = (sessionId: string): void => {
    const session = projectSessions().find((item) => item.id === sessionId);
    const identity = principalId();
    if (!session || !identity) return;
    const next = togglePinnedSession(pinnedSessionKeys(), session);
    setPinnedSessionKeys(next);
    writePinnedSessions(identity, next);
  };

  createEffect(() => {
    setPinnedSessionKeys(readPinnedSessions(principalId()));
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

  const handleNewSession = () => {
    const projectId = defaultProjectId();
    if (projectId) createProjectSession(projectId);
    else setCreating(true);
  };

  const renderSessionRow = (
    session: ProjectSessionInfo,
    projectId: string,
    options: { pinned?: boolean; indent?: number } = {},
  ) => {
    const sessionId = session.id;
    const menuKey = `${options.pinned ? 'pinned' : 'workspace'}:${sessionId}`;
    const selected = () => selectedSessionId() === sessionId;
    const state = () => runtimeState({
      hasSession: true,
      lifecycle: session.lifecycle,
      isOpening: openingSessionId() === sessionId,
      hasRuntime: !!session.activeChatId,
      isSelected: selected(),
      isHydrated: selected() ? runtimeDocsHydrated() : undefined,
      chatStatus: selected() ? chatStatusSignal()[selectedCid() ?? ''] : null,
      hasPendingPermission: selected() && permissions().some((permission) => permission.status === 'pending'),
      turnActive: selected() && turnActive(),
    });
    return (
      <ProjectSessionRow
        session={session}
        state={state()}
        selected={selected()}
        navigationBusy={!!openingSessionId()}
        readOnly={readOnly()}
        renameOpen={editing() === sessionId}
        menuOpen={sessionMenu() === menuKey}
        replacementBusy={creatingSessionProjectId() === projectId}
        pinned={isSessionPinned(session)}
        indent={options.indent}
        onNavigate={() => props.onNavigate?.()}
        onOpen={(sessionId, onCommitted) => { navigateProjectSession(sessionId, { onCommitted }); }}
        onSelectRuntime={(id) => { navigateProjectSession(id); }}
        onRenameOpenChange={(open) => setEditing(open ? sessionId : null)}
        onMenuOpenChange={(open) => setSessionMenu(open ? menuKey : null)}
        onRename={renameProjectSession}
        onCreateReplacement={(title) => { createProjectSession(projectId, title); }}
        onArchiveRequest={setArchiveSessionCandidate}
        onTogglePin={() => toggleSessionPin(sessionId)}
      />
    );
  };

  return (
    <SidebarChrome
      onOpenSystem={props.onOpenSystem}
      nav={<>
        <NavAction icon={<MessageSquarePlus size={16} strokeWidth={1.7} />} label="New session" disabled={readOnly()} onClick={handleNewSession} />
        <NavAction icon={<Search size={16} strokeWidth={1.7} />} label="Search" onClick={() => setSearchOpen(true)} />
      </>}
    >
      <SessionSearch open={searchOpen()} onClose={() => setSearchOpen(false)} onSelected={props.onNavigate} />
      <ArchivedBrowserDialog
        open={archivedBrowserProjectId() !== null}
        onClose={() => setArchivedBrowserProjectId(null)}
        projectId={archivedBrowserProjectId()}
        projectName={archivedBrowserProject()?.name ?? null}
        readOnly={readOnly()}
        restoringProjectId={restoringProject()}
        restoringSessionId={sessionLifecycleBusy()}
        onRestoreProject={(projectId) => runConfirmedMutation(
          () => setRestoringProject(projectId),
          () => setRestoringProject(null),
          (committed, failed) => restoreProject(projectId, committed, failed),
          () => {},
        )}
        onRestoreSession={(sessionId) => runConfirmedMutation(
          () => setSessionLifecycleBusy(sessionId),
          () => setSessionLifecycleBusy(null),
          (committed, failed) => restoreProjectSession(sessionId, committed, failed),
          () => {},
        )}
      />
      <Show when={readOnly()}><div class="readonly-label px-2.5 pb-2 text-11 font-semibold text-warning">Read-only mode</div></Show>
      <Dialog open={creating()} onOpenChange={(open) => { if (!open && !projectCreateSubmitting()) { setCreating(false); setPickDirectoryError(null); } }}><DialogContent dismissible={!projectCreateSubmitting() && !pickingDirectory()}><DialogTitle class="sr-only">New project</DialogTitle>
        <form class="m-0 rounded-12 border-0 bg-surface p-18 shadow-none" onSubmit={submitProject}>
          <div class="mb-9 flex flex-col gap-6">
            <label class="text-12 font-semibold text-text-secondary" for="project-directory">Working directory</label>
            <div class="flex items-center gap-6">
              <input
                id="project-directory"
                class="box-border h-34 min-w-0 flex-1 rounded-9 border border-border-strong bg-surface px-11 text-text-primary outline-none focus:border-focus-ring focus:shadow-[0_0_0_1px_var(--surface),0_0_0_3px_var(--focus-ring)] focus-visible:outline-0"
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

      <Show
        when={registryHydrated()}
        fallback={<LoadingState label="Loading projects" class="sidebar-loading px-2.5 py-2 text-left!" />}
      >
        <Show when={pinnedSessions().length > 0}>
          <SectionHeader title="Pinned" icon={<Pin size={14} strokeWidth={1.7} />} />
          <div class="flex flex-col gap-2 pb-1">
            <For each={pinnedSessions().map((session) => session.id)}>
              {(sessionId) => {
                const session = () => pinnedSessions().find((item) => item.id === sessionId)!;
                return renderSessionRow(session(), session().projectId, { pinned: true });
              }}
            </For>
          </div>
        </Show>

        <SectionHeader title="Workspaces">
          <IconButton size="sm" showTooltip={false} label="Filter workspaces" class="size-28 shrink-0 text-content-muted" onClick={() => setSearchOpen(true)}>
            <ListFilter size={15} strokeWidth={1.7} />
          </IconButton>
          <IconButton size="sm" showTooltip={false} label="New workspace" class="new-project-button size-28 shrink-0 text-content-muted" disabled={readOnly()} onClick={() => setCreating(true)}>
            <Folder size={15} strokeWidth={1.7} />
          </IconButton>
        </SectionHeader>

        <Show
          when={instanceGroups().length > 0}
          fallback={<EmptyState
            variant="inline"
            class="sidebar-empty px-2.5 py-2 text-left!"
            title={projects().length ? 'No active projects' : 'No projects yet'}
            description={projects().length ? 'Restore an archived project to continue.' : 'No connected instances or projects are available.'}
          />}
        >
          <For each={instanceIds()}>{(instanceId) => {
            const instance = () => instanceGroups().find((item) => item.id === instanceId)!;
            return <section class="instance-group group/instance pb-1">
              <div class="instance-row group/instance relative flex min-h-28 items-center gap-8 pl-2.5 pr-4 text-11 text-content-muted">
                <span class="instance-name min-w-0 flex-1 truncate">{instance().name}</span>
                <Show when={instance().offline}>
                  <span class="instance-offline flex shrink-0 items-center gap-4 text-danger-solid" role="img" aria-label="Instance offline">
                    <CloudOff size={13} strokeWidth={1.8} aria-hidden="true" />
                    <span>Offline</span>
                  </span>
                </Show>
                <IconButton
                  size="sm"
                  showTooltip={false}
                  class="new-project-button instance-create-action pointer-events-none absolute right-4 top-1/2 size-24 -translate-y-1/2 border-0 bg-transparent text-content-muted opacity-0 transition-opacity duration-(--duration-fast) group-hover/instance:pointer-events-auto group-hover/instance:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 pointer-coarse:size-32 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
                  label="New project"
                  disabled={readOnly()}
                  onClick={() => setCreating(true)}
                >
                  <PlusIcon />
                </IconButton>
              </div>
              <For each={instance().projects.map((project) => project.id)}>{(projectId) => {
                const project = () => instance().projects.find((item) => item.id === projectId)!;
                const sessions = () => projectSessions().filter((s) => s.projectId === projectId && !s.archivedAt);
                const archivedSessions = () => projectSessions().filter((s) => s.projectId === projectId && !!s.archivedAt);
                const sessionsLoading = () => discoveringSessionsProjectId() === projectId || isProjectCatalogBootstrapPending(projectId);
                const collapsed = () => collapsedProjects().has(projectId);
                const open = () => !collapsed();
                const hasSessions = () => sessions().length > 0;
                const projectMenuId = `project-menu-${projectId}`;
                return <Collapsible as="section" class="project-group min-w-0" open={open()} onOpenChange={(next) => setProjectCollapsed(projectId, !next)}>
                  <div class="group/workspace relative min-w-0 rounded-md hover:bg-interaction-hover focus-within:bg-interaction-hover">
                    <CollapsibleTrigger class="relative z-0 flex w-full min-w-0 items-start gap-8 pl-2.5 pr-[64px] py-4 text-left" aria-label={project().name}>
                      <span class="mt-0.5 shrink-0 text-content-muted">
                        <Show when={open()} fallback={<Folder size={15} strokeWidth={1.7} />}>
                          <FolderOpen size={15} strokeWidth={1.7} />
                        </Show>
                      </span>
                      <span class="min-w-0 flex-1 py-0.5">
                        <span class="min-w-0 flex-1 truncate text-13 text-content-primary">{project().name}</span>
                      </span>
                    </CollapsibleTrigger>
                    <ProjectRowAccessory count={hasSessions() ? sessions().length : undefined} actionsVisible={projectMenu() === projectId}>
                      <ProjectRowActionGroup>
                        <DropdownMenu open={projectMenu() === projectId} onOpenChange={(next) => setProjectMenu(next ? projectId : null)} placement="bottom-end">
                          <DropdownMenuTrigger
                            as={IconButton}
                            size="sm"
                            showTooltip={false}
                            class={`${buttonGroupItemClass} project-menu-trigger`}
                            label={`${project().name} actions`}
                            disabled={readOnly()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <MoreIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent id={projectMenuId} aria-label={`${project().name} actions`} class="ui-menu">
                            <DropdownMenuItem onSelect={() => { setProjectNameDraft(project().name); setRenamingProject(projectId); }}><RenameIcon />Rename project</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setImportingProject(projectId)}><ImportIcon />Import existing session</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setArchivedBrowserProjectId(projectId)}>
                              <ArchiveIcon />
                              Archived
                              <Show when={archivedSessions().length > 0}>
                                <span class="ml-auto text-11 text-content-muted">{archivedSessions().length}</span>
                              </Show>
                            </DropdownMenuItem>
                            <DropdownMenuItem class="text-danger focus:text-danger" disabled={projectHasRunningSession(projectId)} onSelect={() => setArchiveCandidate(projectId)}><ArchiveIcon />Archive project</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <IconButton
                          size="sm"
                          showTooltip={false}
                          class={`${buttonGroupItemClass} row-create-action`}
                          label={`New session in ${project().name}`}
                          busy={creatingSessionProjectId() === projectId}
                          disabled={readOnly() || !!creatingSessionProjectId()}
                          onClick={(event) => {
                            event.stopPropagation();
                            createProjectSession(projectId);
                          }}
                        >
                          <PlusIcon />
                        </IconButton>
                      </ProjectRowActionGroup>
                    </ProjectRowAccessory>
                  </div>
                  <CollapsibleContent id={`project-sessions-${projectId}`} class="session-list flex flex-col gap-2 pb-1">
                    <Show
                      when={hasSessions()}
                      fallback={<Show
                        when={sessionsLoading()}
                        fallback={<button type="button" class="session-empty sidebar-mist-hint px-2.5 py-4 pl-36 text-left text-11 hover:text-content-muted" disabled={readOnly() || !!creatingSessionProjectId()} onClick={() => createProjectSession(projectId)}>Start your first conversation</button>}
                      >
                        <LoadingState label="Loading sessions" class="session-empty px-2.5 py-4 pl-36 text-left!" />
                      </Show>}
                    >
                      <For each={sessions().map((item) => item.id)}>
                        {(sessionId) => {
                          const session = () => sessions().find((item) => item.id === sessionId)!;
                          return renderSessionRow(session(), projectId, { indent: 16 });
                        }}
                      </For>
                    </Show>
                  </CollapsibleContent>
                </Collapsible>;
              }}</For>
            </section>;
          }}</For>
        </Show>
      </Show>

      <Show when={registryHydrated() && projects().some((project) => !!project.archivedAt)}>
        <section class="archived-projects border-t border-border-subtle px-1.5 pt-2">
          <ArchivedSection
            toggleClass="archived-projects__toggle flex w-full min-h-32 cursor-pointer items-center gap-6 rounded-md border-0 bg-transparent px-2.5 text-left text-11 text-content-muted hover:bg-interaction-hover hover:text-content-secondary pointer-coarse:min-h-44"
            label="Archived"
            count={projects().filter((project) => !!project.archivedAt).length}
            open={archivedOpen()}
            onOpenChange={setArchivedOpen}
            listId="archived-project-list"
            listClass="archived-project-list flex max-h-180 flex-col gap-4 overflow-auto py-4"
          >
            <For each={projects().filter((project) => !!project.archivedAt)}>{(project) => <div class="archived-project-row flex min-h-32 items-center gap-8 rounded-md px-2.5 py-4 hover:bg-interaction-hover pointer-coarse:min-h-44"><span class="flex min-w-0 flex-1 flex-col gap-2"><strong class="overflow-hidden text-ellipsis whitespace-nowrap text-12 font-medium text-content-primary">{project.name}</strong><small class="text-10 text-content-muted">{projectSessions().filter((session) => session.projectId === project.id).length} sessions</small></span><Button class="min-h-30! px-8! text-11! pointer-coarse:min-h-44!" busy={restoringProject() === project.id} disabled={readOnly() || !!restoringProject()} onClick={() => runConfirmedMutation(() => setRestoringProject(project.id), () => setRestoringProject(null), (committed, failed) => restoreProject(project.id, committed, failed), () => {})}>Restore</Button></div>}</For>
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
          return <ConfirmDialog
            eyebrow="Session cleanup"
            title={`Archive “${displayTitle()}”?`}
            description="The session will be hidden from the current project list, but the ACP thread, message history, and local project files are not deleted. You can restore it later from the workspace More menu → Archived."
            cancelDisabled={!!sessionLifecycleBusy()}
            confirmLabel="Archive session"
            confirmBusy={!!sessionLifecycleBusy()}
            onCancel={() => setArchiveSessionCandidate(null)}
            onConfirm={() => { const id = archiveSessionCandidate(); if (!id) return; runConfirmedMutation(() => setSessionLifecycleBusy(id), () => setSessionLifecycleBusy(null), (committed, failed) => archiveProjectSession(id, committed, failed), () => setArchiveSessionCandidate(null)); }}
          />;
        })()}
      </DialogContent></Dialog>
    </SidebarChrome>
  );
}
