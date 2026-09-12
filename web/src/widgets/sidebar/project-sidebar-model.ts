import { createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
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
  isTerminal,
  machines,
  navigateProjectSession,
  projects,
  projectSessions,
  registryHydrated,
  renameProject,
  renameProjectSession,
  restoreProject,
  restoreProjectSession,
  selectedSessionId,
} from '@/store';
import { principalId, readOnly } from '@/features/auth/auth-state';
import { runConfirmedMutation } from '@/features/session/form-mutation';
import { pickProjectDirectory } from '@/shared/lib/pick-directory';
import { projectNameFromPath } from '@/shared/lib/project-path';
import { reconcileInstanceGroups, type InstanceGroup } from '@/features/session/instance-groups';
import { selectActiveProjects } from '@/features/catalog/project-catalog';
import { listArchivedEntries } from '@/features/catalog/archived-search';
import type { ProjectSessionInfo } from '@/entities/registry/registry-view';
import {
  readPinnedSessions,
  selectPinnedSessions,
  togglePinnedSession,
  writePinnedSessions,
  type SessionPin,
} from '@/features/session/session-pins';
import { isLocalMachine, sortMachinesForPanel } from '@/entities/machine/machine-view';

export interface ProjectSidebarIntent {
  kind: 'create-project' | 'import';
  projectId?: string;
  nonce: number;
}

export function createProjectSidebarModel(intent: () => ProjectSidebarIntent | null | undefined) {
  const [creating, setCreating] = createSignal(false);
  const [projectInstanceId, setProjectInstanceId] = createSignal('local');
  const [projectCreateSubmitting, setProjectCreateSubmitting] = createSignal(false);
  const [pickingDirectory, setPickingDirectory] = createSignal(false);
  const [pickDirectoryError, setPickDirectoryError] = createSignal<string | null>(null);
  const [cwd, setCwd] = createSignal('');
  const [editing, setEditing] = createSignal<string | null>(null);
  const [sessionMenu, setSessionMenu] = createSignal<string | null>(null);
  const [sessionLifecycleBusy, setSessionLifecycleBusy] = createSignal<string | null>(null);
  const [importingProject, setImportingProject] = createSignal<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = createSignal(new Set<string>());
  const [projectMenu, setProjectMenu] = createSignal<string | null>(null);
  const [archiveCandidate, setArchiveCandidate] = createSignal<string | null>(null);
  const [archiveSubmitting, setArchiveSubmitting] = createSignal(false);
  const [archivedBrowserProjectId, setArchivedBrowserProjectId] = createSignal<string | null>(null);
  const [archivedBrowserGlobalOpen, setArchivedBrowserGlobalOpen] = createSignal(false);
  const [restoringProject, setRestoringProject] = createSignal<string | null>(null);
  const [renamingProject, setRenamingProject] = createSignal<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = createSignal('');
  const [projectRenameSubmitting, setProjectRenameSubmitting] = createSignal(false);
  const [remoteBrowseOpen, setRemoteBrowseOpen] = createSignal(false);
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
  const archivedEntryCount = () => listArchivedEntries(projects(), projectSessions()).length;
  const sessionHasRunningRuntime = (session: { id: string; activeChatId?: string | null }) => {
    if (!session.activeChatId) return false;
    return session.id !== selectedSessionId() || !isTerminal(chatStatusSignal()[session.activeChatId]);
  };
  const projectHasRunningSession = (projectId: string) => projectSessions().some((session) => session.projectId === projectId && sessionHasRunningRuntime(session));
  const instanceGroups = createMemo<InstanceGroup[]>((previous = []) => reconcileInstanceGroups(
    instances(),
    activeProjects(),
    machines(),
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
    const value = intent();
    if (!value) return;
    if (value.kind === 'create-project') openCreateProject('local');
    if (value.kind === 'import' && value.projectId) {
      setImportingProject(value.projectId);
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

  const machineOnline = (instanceId: string) => instances().some((row) => row.id === instanceId && row.status === 'online');
  const selectableMachines = () => sortMachinesForPanel(
    machines().filter((machine) => !machine.archivedAt && (isLocalMachine(machine) || machineOnline(machine.instanceId))),
  );
  const isRemoteInstance = (instanceId: string) => instanceId !== 'local';

  const openCreateProject = (instanceId = 'local') => {
    setProjectInstanceId(instanceId);
    setPickDirectoryError(null);
    setCreating(true);
  };

  const submitProject = (e: SubmitEvent) => {
    e.preventDefault();
    const directory = cwd().trim();
    if (!directory || projectCreateSubmitting()) return;
    const instanceId = projectInstanceId();
    if (instanceId !== 'local' && !machineOnline(instanceId)) return;
    const boundInstance = instanceId === 'local' ? undefined : instanceId;
    runConfirmedMutation(
      () => setProjectCreateSubmitting(true),
      () => setProjectCreateSubmitting(false),
      (committed, failed) => createProject(projectNameFromPath(directory), directory, boundInstance, committed, failed),
      () => { setCwd(''); setPickDirectoryError(null); setProjectInstanceId('local'); setCreating(false); },
    );
  };

  const browseProjectDirectory = async () => {
    if (pickingDirectory() || projectCreateSubmitting()) return;
    setPickDirectoryError(null);
    if (isRemoteInstance(projectInstanceId())) {
      setRemoteBrowseOpen(true);
      return;
    }
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
    else openCreateProject();
  };

  const requestArchiveSession = (sessionId: string) => {
    if (sessionLifecycleBusy()) return;
    runConfirmedMutation(
      () => setSessionLifecycleBusy(sessionId),
      () => setSessionLifecycleBusy(null),
      (committed, failed) => archiveProjectSession(sessionId, committed, failed),
      () => {},
    );
  };

  return {
    creating, setCreating,
    projectInstanceId, setProjectInstanceId,
    projectCreateSubmitting, setProjectCreateSubmitting,
    pickingDirectory, setPickingDirectory,
    pickDirectoryError, setPickDirectoryError,
    cwd, setCwd,
    editing, setEditing,
    sessionMenu, setSessionMenu,
    sessionLifecycleBusy, setSessionLifecycleBusy,
    importingProject, setImportingProject,
    collapsedProjects,
    setProjectCollapsed,
    projectMenu, setProjectMenu,
    archiveCandidate, setArchiveCandidate,
    archiveSubmitting, setArchiveSubmitting,
    archivedBrowserProjectId, setArchivedBrowserProjectId,
    archivedBrowserGlobalOpen, setArchivedBrowserGlobalOpen,
    restoringProject, setRestoringProject,
    renamingProject, setRenamingProject,
    projectNameDraft, setProjectNameDraft,
    projectRenameSubmitting, setProjectRenameSubmitting,
    remoteBrowseOpen, setRemoteBrowseOpen,
    searchOpen, setSearchOpen,
    pinnedSessions,
    archivedBrowserProject,
    archivedEntryCount,
    projectHasRunningSession,
    instanceGroups,
    instanceIds,
    openCreateProject,
    submitProject,
    browseProjectDirectory,
    handleNewSession,
    requestArchiveSession,
    isSessionPinned,
    toggleSessionPin,
    machineOnline,
    selectableMachines,
    isRemoteInstance,
    registryHydrated,
    readOnly,
    projects,
    projectSessions,
    importableSessions,
    discoveringSessionsProjectId,
    isProjectCatalogBootstrapPending,
    creatingSessionProjectId,
    discoverProjectSessions,
    importProjectSession,
    renameProjectSession,
    renameProject,
    archiveProject,
    archiveProjectSession,
    restoreProject,
    restoreProjectSession,
    navigateProjectSession,
    createProjectSession,
  };
}

export type ProjectSidebarModel = ReturnType<typeof createProjectSidebarModel>;
