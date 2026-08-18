import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { archiveProject, archiveProjectSession, chatStatusSignal, createProject, createProjectSession, creatingSessionProjectId, discoverProjectSessions, discoveringSessionsProjectId, importableSessions, importProjectSession, navigateProjectSession, openingSessionId, permissions, projects, projectSessions, renameProject, renameProjectSession, restoreProject, restoreProjectSession, runtimeDocsHydrated, selectedCid, selectedSessionId, turnActive } from '../store';
import { isTerminal } from '../lib/action-state';
import { connState } from '../lib/connection';
import { readOnly } from '../lib/auth-state';
import { Button, Dialog, Icon, IconButton, Menu, MenuItem, primaryShortcut, Status, TextField } from '../../ui';
import { useAuthActions } from '../lib/auth-hook';
import { SessionSearch } from './SessionSearch';
import { SessionImportDialog } from './SessionImportDialog';
import { ProjectSessionRow } from './ProjectSessionRow';
import { runConfirmedMutation } from '../lib/form-mutation';
import { runtimeState } from '../lib/runtime-state.ts';
import { sessionDisplayTitle } from '../lib/recovery-state.ts';
import { ArchivedSection } from './shared/ArchivedSection';
import { ConfirmDialog } from './shared/ConfirmDialog';

function PlusIcon() { return <Icon><path d="M10 4v12M4 10h12" /></Icon>; }
function ImportIcon() { return <Icon class="size-17!"><path d="M10 3v9m0 0 3-3m-3 3L7 9M4 14.5h12v2H4z" /></Icon>; }
function ChevronIcon(props: { class?: string }) { return <Icon size="small" class={`size-16 flex-none text-text-muted ${props.class ?? ''}`}><path d="m7 5 5 5-5 5" /></Icon>; }
function MoreIcon() { return <Icon><circle cx="4" cy="10" r="1" /><circle cx="10" cy="10" r="1" /><circle cx="16" cy="10" r="1" /></Icon>; }
function SearchIcon() { return <Icon><circle cx="8.5" cy="8.5" r="5" /><path d="m12.2 12.2 4 4" /></Icon>; }

export function ProjectSidebar(props: { onNavigate?: () => void; onOpenSystem?: () => void; intent?: { kind: 'create-project' | 'import'; projectId?: string; nonce: number } | null }) {
  const [creating, setCreating] = createSignal(false);
  const [projectCreateSubmitting, setProjectCreateSubmitting] = createSignal(false);
  const [name, setName] = createSignal('');
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
  const auth = useAuthActions();
  const sessionHasRunningRuntime = (session: { id: string; activeChatId?: string | null }) => {
    if (!session.activeChatId) return false;
    return session.id !== selectedSessionId() || !isTerminal(chatStatusSignal()[session.activeChatId]);
  };
  const projectHasRunningSession = (projectId: string) => projectSessions().some((session) => session.projectId === projectId && sessionHasRunningRuntime(session));
  const toggleProject = (projectId: string) => setCollapsedProjects((current) => {
    const next = new Set(current);
    if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
    return next;
  });
  const toggleArchivedSessions = (projectId: string) => setArchivedSessionsOpen((current) => {
    const next = new Set(current);
    if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
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
    if (!selectedId) return;
    const projectId = projectSessions().find((session) => session.id === selectedId)?.projectId;
    if (!projectId || !collapsedProjects().has(projectId)) return;
    setCollapsedProjects((current) => {
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
    queueMicrotask(() => document.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' }));
  });

  const submitProject = (e: SubmitEvent) => {
    e.preventDefault();
    if (!cwd().trim() || projectCreateSubmitting()) return;
    runConfirmedMutation(
      () => setProjectCreateSubmitting(true),
      () => setProjectCreateSubmitting(false),
      (committed, failed) => createProject(name().trim() || cwd().split('/').filter(Boolean).at(-1) || 'Project', cwd().trim(), committed, failed),
      () => { setName(''); setCwd(''); setCreating(false); },
    );
  };

  return (
    <nav class="project-sidebar flex h-full min-h-0 flex-col px-12 desk:px-9 wide:px-12" aria-label="Projects & Sessions">
      <div class="brand-row flex h-60 items-center gap-9 px-8 text-15 font-650 -tracking-1 desk:h-56 desk:px-6 wide:h-60 wide:px-8"><span class="brand-glyph grid size-26 place-items-center rounded-8 bg-text-primary text-12 text-surface">✦</span><span>Peri Studio</span></div>
      <Button class="new-project-button w-full justify-start! mb-14 desk:mb-12 wide:mb-14" disabled={readOnly()} onClick={() => setCreating(true)}><PlusIcon />New project</Button>
      <Button class="session-search-button w-full justify-start! -mt-8 mb-12 text-text-muted!" onClick={() => setSearchOpen(true)}><SearchIcon />Search sessions<kbd class="ml-auto rounded-5 border border-border-subtle bg-surface px-5 py-1 font-inherit text-11 text-text-muted">{primaryShortcut('K')}</kbd></Button>
      <SessionSearch open={searchOpen()} onClose={() => setSearchOpen(false)} onSelected={props.onNavigate} />
      <Show when={readOnly()}><div class="readonly-label -mt-8 mx-8 mb-12 text-11 font-semibold text-warning">Read-only mode</div></Show>
      <Dialog open={creating()} title="New project" dismissible={!projectCreateSubmitting()} onClose={() => setCreating(false)}>
        <form class="project-form" onSubmit={submitProject}>
          <TextField label="Project name" value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="perihelion" autofocus />
          <TextField label="Working directory" value={cwd()} onInput={(e) => setCwd(e.currentTarget.value)} placeholder="/absolute/path" />
          <div class="form-actions"><Button type="button" disabled={projectCreateSubmitting()} onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" type="submit" busy={projectCreateSubmitting()} disabled={!cwd().trim()}>Create</Button></div>
        </form>
      </Dialog>
      <div class="project-scroll min-h-0 flex-1 overflow-auto pb-16">
        <Show when={projects().length} fallback={<p class="sidebar-empty mx-8 border-0 bg-transparent p-8 text-left text-12 text-text-muted">Create a project, then start a new session from the + on the right.</p>}>
          <For each={projects().filter((p) => !p.archivedAt)}>{(project) => {
            const sessions = () => projectSessions().filter((s) => s.projectId === project.id && !s.archivedAt);
            const archivedSessions = () => projectSessions().filter((s) => s.projectId === project.id && !!s.archivedAt);
            const collapsed = () => collapsedProjects().has(project.id);
            const projectMenuId = `project-menu-${project.id}`;
            let projectMenuTrigger: HTMLButtonElement | undefined;
            return <section class="project-group relative mt-4 mb-18 desk:mb-14 wide:mb-18">
              <div class="project-heading relative flex min-h-42 items-center gap-2 pl-2 pointer-coarse:min-h-52">
                <button type="button" class={`project-disclosure flex min-h-38 min-w-0 flex-1 cursor-pointer items-center gap-5 rounded-8 border-0 bg-transparent px-3 text-left text-text-primary hover:bg-surface-hover-translucent pointer-coarse:min-h-44 ${collapsed() ? '' : 'is-expanded'}`} aria-expanded={!collapsed()} aria-controls={`project-sessions-${project.id}`} onClick={() => toggleProject(project.id)}><ChevronIcon class={collapsed() ? '' : 'rotate-90'} /><span class="flex min-w-0 flex-col gap-1"><strong class="overflow-hidden text-ellipsis whitespace-nowrap text-12p5 font-650 -tracking-5">{project.name}</strong><small class="text-10 font-450 text-text-muted">{sessions().length ? `${sessions().length} sessions` : 'No sessions yet'}</small></span></button>
                <IconButton tooltipPlacement="end" label={`New session in ${project.name}`} busy={creatingSessionProjectId() === project.id} disabled={readOnly() || !!creatingSessionProjectId()} onClick={() => createProjectSession(project.id)}><PlusIcon /></IconButton>
                <IconButton tooltipPlacement="end" ref={projectMenuTrigger} label={`${project.name} actions`} disabled={readOnly()} aria-haspopup="menu" aria-expanded={projectMenu() === project.id} aria-controls={projectMenu() === project.id ? projectMenuId : undefined} onClick={() => setProjectMenu((open) => open === project.id ? null : project.id)}><MoreIcon /></IconButton>
                <Menu open={projectMenu() === project.id} id={projectMenuId} label={`${project.name} actions`} trigger={() => projectMenuTrigger} onClose={() => setProjectMenu(null)}>
                  <MenuItem class="flex items-center gap-9" onClick={() => { setProjectMenu(null); setProjectNameDraft(project.name); setRenamingProject(project.id); }}>Rename project</MenuItem>
                  <MenuItem class="flex items-center gap-9" onClick={() => { setProjectMenu(null); setImportingProject(project.id); }}><ImportIcon />Import existing session</MenuItem>
                  <MenuItem class="flex items-center gap-9" tone="danger" disabled={projectHasRunningSession(project.id)} title={projectHasRunningSession(project.id) ? 'Close the running sessions in this project first' : undefined} onClick={() => { setProjectMenu(null); setArchiveCandidate(project.id); }}>Archive project</MenuItem>
                </Menu>
              </div>
              <div id={`project-sessions-${project.id}`} class="session-list flex flex-col gap-2" hidden={collapsed()}>
                <For each={sessions()} fallback={<Button busy={creatingSessionProjectId() === project.id} disabled={readOnly() || !!creatingSessionProjectId()} class="session-empty mx-8 cursor-pointer rounded-8! border-0! bg-transparent p-8! text-left text-12! text-text-muted! hover:bg-hover hover:text-text-secondary!" onClick={() => createProjectSession(project.id)}>Start your first conversation</Button>}>
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
                      opening={openingSessionId() === session.id}
                      navigationBusy={!!openingSessionId()}
                      readOnly={readOnly()}
                      renameOpen={editing() === session.id}
                      menuOpen={sessionMenu() === session.id}
                      runtimeActive={sessionHasRunningRuntime(session)}
                      replacementBusy={creatingSessionProjectId() === project.id}
                      onNavigate={() => props.onNavigate?.()}
                      onOpen={(sessionId, onCommitted) => { navigateProjectSession(sessionId, { onCommitted }); }}
                      onSelectRuntime={(sessionId) => { navigateProjectSession(sessionId); }}
                      onRenameOpenChange={(open) => setEditing(open ? session.id : null)}
                      onMenuOpenChange={(open) => setSessionMenu(open ? session.id : null)}
                      onRename={renameProjectSession}
                      onCreateReplacement={(title) => { createProjectSession(project.id, title); }}
                      onArchiveRequest={setArchiveSessionCandidate}
                    />;
                  }}
                </For>
                <Show when={archivedSessions().length > 0}>
                  <ArchivedSection
                    toggleClass="archived-sessions__toggle flex w-full min-h-34 cursor-pointer items-center gap-6 mt-4 rounded-8 border-0 bg-transparent px-8 text-left text-11 text-text-muted hover:bg-hover hover:text-text-secondary pointer-coarse:min-h-44"
                    label="Archived sessions"
                    count={archivedSessions().length}
                    open={archivedSessionsOpen().has(project.id)}
                    onToggle={() => toggleArchivedSessions(project.id)}
                    listId={`archived-sessions-${project.id}`}
                    listClass="archived-session-list flex flex-col gap-2 pt-2 pr-3 pb-5 pl-16"
                  >
                    <For each={archivedSessions()}>{(session) => <div class="archived-session-row flex min-h-42 items-center gap-8 rounded-8 py-3 pr-4 pl-8 hover:bg-hover"><span class="flex min-w-0 flex-1 flex-col gap-2"><strong class="overflow-hidden text-ellipsis whitespace-nowrap text-12 font-550">{sessionDisplayTitle(session.title, session.acpSessionId || session.id)}</strong><small class="text-10 text-text-muted">{session.lifecycle === 'ready' ? 'Session saved' : session.lifecycle}</small></span><Button size="compact" class="min-h-30! px-8! text-11! pointer-coarse:min-h-44!" busy={sessionLifecycleBusy() === session.id} disabled={readOnly() || !!sessionLifecycleBusy()} onClick={() => runConfirmedMutation(() => setSessionLifecycleBusy(session.id), () => setSessionLifecycleBusy(null), (committed, failed) => restoreProjectSession(session.id, committed, failed), () => {})}>Restore</Button></div>}</For>
                  </ArchivedSection>
                </Show>
              </div>
            </section>;
          }}</For>
        </Show>
      </div>
      <Show when={projects().some((project) => !!project.archivedAt)}>
        <section class="archived-projects mx-2 mb-8 border-t border-divider pt-7">
          <ArchivedSection
            toggleClass="archived-projects__toggle flex w-full min-h-34 cursor-pointer items-center gap-6 rounded-8 border-0 bg-transparent px-7 text-left text-11 text-text-muted hover:bg-hover hover:text-text-secondary pointer-coarse:min-h-44"
            label="Archived"
            count={projects().filter((project) => !!project.archivedAt).length}
            open={archivedOpen()}
            onToggle={() => setArchivedOpen((open) => !open)}
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
      <Dialog open={!!renamingProject()} title="Rename project" dismissible={!projectRenameSubmitting()} onClose={() => setRenamingProject(null)}>
        <form class="project-form" onSubmit={(event) => { event.preventDefault(); const id = renamingProject(); if (!id || !projectNameDraft().trim()) return; runConfirmedMutation(() => setProjectRenameSubmitting(true), () => setProjectRenameSubmitting(false), (committed, failed) => renameProject(id, projectNameDraft(), committed, failed), () => setRenamingProject(null)); }}>
          <TextField label="Project name" value={projectNameDraft()} onInput={(event) => setProjectNameDraft(event.currentTarget.value)} autofocus />
          <p class="form-note">Only renames the sidebar entry; the working directory and ACP session are unchanged.</p>
          <div class="form-actions"><Button disabled={projectRenameSubmitting()} onClick={() => setRenamingProject(null)}>Cancel</Button><Button variant="primary" type="submit" busy={projectRenameSubmitting()} disabled={!projectNameDraft().trim()}>Save</Button></div>
        </form>
      </Dialog>
      <Dialog open={!!archiveCandidate()} title="Archive project" dismissible={!archiveSubmitting()} onClose={() => setArchiveCandidate(null)}>
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
      </Dialog>
      <Dialog open={!!archiveSessionCandidate()} title="Archive session" dismissible={!sessionLifecycleBusy()} onClose={() => setArchiveSessionCandidate(null)}>
        {(() => {
          const session = () => projectSessions().find((item) => item.id === archiveSessionCandidate());
          const displayTitle = () => sessionDisplayTitle(session()?.title, session()?.acpSessionId || session()?.id);
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
      </Dialog>
      <div class="sidebar-footer flex min-h-58 items-center gap-6 border-t border-divider text-12 text-text-muted">
        <Status tone={connState().kind || 'idle'} class="min-w-0 flex-1">{connState().text}</Status>
        <Button size="compact" class="min-h-36! cursor-pointer rounded-8! border-0! bg-transparent px-9! text-text-secondary! hover:bg-hover hover:text-text-primary! pointer-coarse:min-h-44!" onClick={props.onOpenSystem}>System</Button>
        <Button size="compact" class="min-h-36! cursor-pointer rounded-8! border-0! bg-transparent px-9! text-text-secondary! hover:bg-hover hover:text-text-primary! pointer-coarse:min-h-44!" onClick={auth?.logout}>Log out</Button>
      </div>
    </nav>
  );
}
