import { fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  archiveProject: vi.fn(),
  archiveProjectSession: vi.fn(),
  toast: vi.fn(),
  chatStatusSignal: vi.fn(() => ({})),
  connState: vi.fn(() => ({ kind: 'ok', text: 'Connected' })),
  createProject: vi.fn(),
  createProjectSession: vi.fn(),
  creatingSessionProjectId: vi.fn(() => null as string | null),
  discoverProjectSessions: vi.fn(() => true),
  discoveringSessionsProjectId: vi.fn(() => null as string | null),
  isProjectCatalogBootstrapPending: vi.fn(() => false),
  importableSessions: vi.fn(() => []),
  importProjectSession: vi.fn(),
  instances: vi.fn(() => [{ id: 'local', hostname: 'Local instance', status: 'online' }]),
  machines: vi.fn(() => [{
    instanceId: 'local',
    kind: 'local',
    displayName: 'This computer',
    sshDestination: null,
    sshPort: null,
    phase: 'online',
    errorCode: null,
    hasIdentityFile: false,
    autoReconnect: false,
    hostKeySha256: null,
    updatedAt: null,
    archivedAt: null,
  }]),
  navigateProjectSession: vi.fn(),
  openingSessionId: vi.fn(() => null as string | null),
  permissions: vi.fn(() => []),
  registryHydrated: vi.fn(() => true),
  projects: vi.fn(() => [{
    id: 'p1',
    name: 'Perihelion',
    cwd: '/repo',
    instanceId: 'local',
    createdAt: '2026-08-13T10:00:00Z',
    updatedAt: '2026-08-13T10:00:00Z',
    archivedAt: null as string | null,
  }]),
  projectSessions: vi.fn(() => [{
    id: 'acp-12345678',
    projectId: 'p1',
    title: 'Architecture refactor',
    lifecycle: 'ready',
    updatedAt: '2026-08-13T10:00:00Z',
    lastOpenedAt: null as string | null,
    activeChatId: null as string | null,
    archivedAt: null as string | null,
  }]),
  readOnly: vi.fn(() => false),
  runtimeDocsHydrated: vi.fn(() => true),
  renameProject: vi.fn(),
  renameProjectSession: vi.fn(),
  remoteDirectoryBrowsePorts: {
    ready: () => true,
    send: vi.fn(() => true),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  },
  restoreProject: vi.fn(),
  restoreProjectSession: vi.fn(),
  selectedCid: vi.fn(() => null as string | null),
  selectedSessionId: vi.fn(() => null as string | null),
  chatTurnActiveSignal: vi.fn(() => ({}) as Record<string, boolean>),
  turnActive: vi.fn(() => false),
}));

vi.mock('@/store', () => store);
vi.mock('@/features/auth/auth-state', () => ({ principalId: () => 'test-principal', readOnly: store.readOnly }));
vi.mock('@/widgets/auth/AuthGate', () => ({ useAuthActions: () => ({ logout: vi.fn() }) }));

import { renderWithSidebarProvider } from '@/widgets/shell/sidebar-test-shell';
import { ProjectSidebar } from './ProjectSidebar';
import { primaryShortcut } from '@/shared/lib/keyboard';

const render = renderWithSidebarProvider;

function sessionButton() {
  return screen.getByRole('button', { name: /^Architecture refactor/ });
}

describe('ProjectSidebar registry hydration', () => {
  afterEach(() => {
    store.registryHydrated.mockReturnValue(true);
  });

  it('keeps an unknown registry as a loading surface instead of an empty directory', () => {
    store.registryHydrated.mockReturnValue(false);
    store.projects.mockReturnValue([]);

    render(() => <ProjectSidebar />);

    expect(screen.getByRole('status', { name: 'Loading projects' })).toBeInTheDocument();
    expect(screen.queryByText('No projects yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Search sessions/ })).not.toBeInTheDocument();
  });

  it('shows connected instances without inventing an empty project directory', () => {
    store.projects.mockReturnValue([]);

    render(() => <ProjectSidebar />);

    expect(screen.getByText('This computer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New project' })).toBeEnabled();
    expect(screen.queryByText('No projects yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Root workspace')).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading projects' })).not.toBeInTheDocument();
  });

  it('keeps archived projects separate while retaining their instance', () => {
    store.projects.mockReturnValue([{ id: 'archived', name: 'Archived project', cwd: '/repo', instanceId: 'local', createdAt: '2026-08-13T10:00:00Z', updatedAt: '2026-08-13T10:00:00Z', archivedAt: '2026-08-14T10:00:00Z' }]);

    render(() => <ProjectSidebar />);

    expect(screen.getByText('This computer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archived project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Archived · / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Archived sessions/ })).not.toBeInTheDocument();
  });
  it('renders an offline instance without projects and exposes its offline state', () => {
    store.projects.mockReturnValue([]);
    store.instances.mockReturnValue([{ id: 'remote', hostname: 'Remote instance', status: 'offline' }]);

    render(() => <ProjectSidebar />);

    expect(screen.getByText('Remote instance')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Instance offline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New project' })).toBeEnabled();
  });

  beforeEach(() => {
    window.localStorage.clear();
    store.registryHydrated.mockReturnValue(true);
    store.projects.mockReturnValue([{ id: 'p1', name: 'Perihelion', cwd: '/repo', instanceId: 'local', createdAt: '2026-08-13T10:00:00Z', updatedAt: '2026-08-13T10:00:00Z', archivedAt: null }]);
    store.navigateProjectSession.mockReset();
    store.archiveProjectSession.mockReset();
    store.archiveProject.mockReset();
    store.toast.mockReset();
    store.openingSessionId.mockReturnValue(null);
    store.instances.mockReturnValue([{ id: 'local', hostname: 'Local instance', status: 'online' }]);
    store.readOnly.mockReturnValue(false);
    store.selectedSessionId.mockReturnValue(null);
    store.selectedCid.mockReturnValue(null);
    store.turnActive.mockReturnValue(false);
    store.chatStatusSignal.mockReturnValue({});
    store.chatTurnActiveSignal.mockReturnValue({});
    store.runtimeDocsHydrated.mockReturnValue(true);
    store.projectSessions.mockReturnValue([{
      id: 'acp-12345678',
      projectId: 'p1',
      title: 'Architecture refactor',
      lifecycle: 'ready',
      updatedAt: '2026-08-13T10:00:00Z',
      lastOpenedAt: null,
      activeChatId: null,
      archivedAt: null,
    }]);
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('does not classify every opened session as pinned', () => {
    store.projectSessions.mockReturnValue([{
      id: 'acp-12345678',
      projectId: 'p1',
      title: 'Architecture refactor',
      lifecycle: 'ready',
      updatedAt: '2026-08-13T10:00:00Z',
      lastOpenedAt: '2026-08-14T10:00:00Z',
      activeChatId: null,
      archivedAt: null,
    }]);

    render(() => <ProjectSidebar />);

    expect(screen.queryByText('Pinned')).not.toBeInTheDocument();
  });

  it('pins explicitly and keeps the pin order independent from open recency', () => {
    store.projectSessions.mockReturnValue([
      {
        id: 'session-a',
        projectId: 'p1',
        title: 'Session A',
        lifecycle: 'ready',
        updatedAt: '2026-08-13T10:00:00Z',
        lastOpenedAt: '2026-08-14T10:00:00Z',
        activeChatId: null,
        archivedAt: null,
      },
      {
        id: 'session-b',
        projectId: 'p1',
        title: 'Session B',
        lifecycle: 'ready',
        updatedAt: '2026-08-13T09:00:00Z',
        lastOpenedAt: '2026-08-15T10:00:00Z',
        activeChatId: null,
        archivedAt: null,
      },
    ]);
    // 显式 pin session-a 在前；session-b 更近打开也不应排到它前面。
    window.localStorage.setItem(
      'peri_studio:pinned_sessions:test-principal',
      JSON.stringify([{ projectId: 'p1', sessionId: 'session-a' }]),
    );

    render(() => <ProjectSidebar />);

    expect(screen.getByText('Pinned')).toBeInTheDocument();
    const pinnedList = screen.getByTestId('pinned-list');
    const pinnedSession = pinnedList.querySelector('[data-session-id="session-a"]') as HTMLElement;
    const workspaceSession = screen.getByTestId('session-list').querySelector('[data-session-id="session-a"]') as HTMLElement;
    expect(pinnedSession).toBeInTheDocument();
    expect(pinnedSession.style.paddingLeft).toBe(workspaceSession.style.paddingLeft);
    expect(pinnedList.querySelector('[data-session-id="session-b"]')).not.toBeInTheDocument();
  });

  it('uses folder disclosure for project sessions', () => {
    render(() => <ProjectSidebar />);
    const disclosure = screen.getByRole('button', { name: 'Perihelion' });
    expect(screen.getByTestId('session-list')).not.toHaveClass('border-l', 'border-divider');
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /^Architecture refactor/ })).not.toBeInTheDocument();
  });

  it('lets the selected project stay collapsed after the user closes it', async () => {
    store.selectedSessionId.mockReturnValue('acp-12345678');
    render(() => <ProjectSidebar />);
    const disclosure = screen.getByRole('button', { name: 'Perihelion' });

    fireEvent.click(disclosure);

    await waitFor(() => expect(disclosure).toHaveAttribute('aria-expanded', 'false'));
  });

  it('exposes workspace more actions for each project row', () => {
    render(() => <ProjectSidebar />);
    expect(screen.getByRole('button', { name: 'Perihelion actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('exposes sandbox-aligned nav actions while retaining project creation', () => {
    render(() => <ProjectSidebar />);
    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument();
    expect(screen.queryByText('Projects')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New project' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'New workspace' })).toBeInTheDocument();
  });

  it('keeps session and workspace copy full width with floating row accessories', () => {
    render(() => <ProjectSidebar />);

    expect(sessionButton()).not.toHaveClass('pr-(--sidebar-row-accessory-pr-session)');
    expect(screen.getByRole('button', { name: 'Perihelion' })).not.toHaveClass('pr-(--sidebar-row-accessory-pr-workspace)');
    expect(screen.getByTestId('session-row').querySelector('.row-accessory-slot')).toBeInTheDocument();
  });

  it('keeps sidebar controls free of tooltip wrappers and native title hints', () => {
    render(() => <ProjectSidebar />);

    expect(screen.getByTestId('project-sidebar').querySelector('.ui-tooltip-anchor')).toBeNull();
    expect(screen.getByTestId('project-sidebar').querySelector('[title]')).toBeNull();
  });

  it('waits for the exact open command to commit before navigating', () => {
    const navigate = vi.fn();
    let callbacks: { onCommitted?: () => void; onFailed?: (message: string) => void } = {};
    store.navigateProjectSession.mockImplementation((_sessionId, value) => {
      callbacks = value;
      return true;
    });

    render(() => <ProjectSidebar onNavigate={navigate} />);
    fireEvent.click(sessionButton());

    expect(store.navigateProjectSession).toHaveBeenCalledWith('acp-12345678', expect.any(Object));
    expect(navigate).not.toHaveBeenCalled();
    callbacks.onCommitted?.();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('keeps the current navigation context when opening fails', () => {
    const navigate = vi.fn();
    store.navigateProjectSession.mockImplementation((_sessionId, callbacks) => {
      callbacks.onFailed?.('ACP instance offline');
      return true;
    });

    render(() => <ProjectSidebar onNavigate={navigate} />);
    fireEvent.click(sessionButton());

    expect(navigate).not.toHaveBeenCalled();
  });

  it('lets read-only users switch to an existing runtime without a mutation', () => {
    const navigate = vi.fn();
    store.readOnly.mockReturnValue(true);
    store.projectSessions.mockReturnValue([{
      id: 'acp-12345678',
      projectId: 'p1',
      title: 'Architecture refactor',
      lifecycle: 'ready',
      updatedAt: '2026-08-13T10:00:00Z',
      lastOpenedAt: null,
      activeChatId: 'chat-live',
      archivedAt: null,
    }]);

    render(() => <ProjectSidebar onNavigate={navigate} />);
    fireEvent.click(sessionButton());

    expect(store.navigateProjectSession).toHaveBeenCalledWith('acp-12345678');
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('keeps an unselected idle live runtime switchable without a status lamp', () => {
    store.projectSessions.mockReturnValue([{
      id: 'acp-12345678',
      projectId: 'p1',
      title: 'Architecture refactor',
      lifecycle: 'ready',
      updatedAt: '2026-08-13T10:00:00Z',
      lastOpenedAt: null,
      activeChatId: 'chat-live',
      archivedAt: null,
    }]);

    render(() => <ProjectSidebar />);

    expect(screen.queryByTestId('session-loading-wave')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ready/)).not.toBeInTheDocument();
  });

  it('does not flash a busy lamp while switching into an idle live session', () => {
    store.projectSessions.mockReturnValue([{
      id: 'acp-12345678',
      projectId: 'p1',
      title: 'Architecture refactor',
      lifecycle: 'ready',
      updatedAt: '2026-08-13T10:00:00Z',
      lastOpenedAt: null,
      activeChatId: 'chat-live',
      archivedAt: null,
    }]);
    store.selectedSessionId.mockReturnValue('acp-12345678');
    store.selectedCid.mockReturnValue('chat-previous');
    store.openingSessionId.mockReturnValue('acp-12345678');
    store.runtimeDocsHydrated.mockReturnValue(false);
    store.chatStatusSignal.mockReturnValue({ 'chat-live': 'accepting' });
    store.turnActive.mockReturnValue(true);

    render(() => <ProjectSidebar />);

    expect(screen.queryByTestId('session-loading-wave')).not.toBeInTheDocument();
  });

  it('keeps an unselected working runtime visible as that session’s own status lamp', () => {
    store.projectSessions.mockReturnValue([{
      id: 'acp-12345678',
      projectId: 'p1',
      title: 'Architecture refactor',
      lifecycle: 'ready',
      updatedAt: '2026-08-13T10:00:00Z',
      lastOpenedAt: null,
      activeChatId: 'chat-live',
      archivedAt: null,
    }]);
    store.selectedSessionId.mockReturnValue('other-session');
    store.chatTurnActiveSignal.mockReturnValue({ 'chat-live': true });

    render(() => <ProjectSidebar />);

    const lamp = screen.getByTestId('session-loading-wave');
    expect(lamp).toHaveAttribute('aria-label', 'Agent is working');
    expect(lamp).toHaveAttribute('data-tone', 'busy');
    expect(lamp).toHaveClass('absolute', 'left-8');
  });

  it('shows a danger lamp on an unselected crashed runtime', () => {
    store.projectSessions.mockReturnValue([{
      id: 'acp-12345678',
      projectId: 'p1',
      title: 'Architecture refactor',
      lifecycle: 'ready',
      updatedAt: '2026-08-13T10:00:00Z',
      lastOpenedAt: null,
      activeChatId: 'chat-live',
      archivedAt: null,
    }]);
    store.chatStatusSignal.mockReturnValue({ 'chat-live': 'crashed' });

    render(() => <ProjectSidebar />);

    expect(screen.getByTestId('session-loading-wave')).toHaveAttribute('data-tone', 'danger');
    expect(screen.getByTestId('session-loading-wave-core')).toHaveClass('bg-danger-solid');
  });

  it('archives a session in one click without a confirm dialog', () => {
    store.archiveProjectSession.mockReturnValue(true);

    render(() => <ProjectSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive session' }));

    expect(store.archiveProjectSession).toHaveBeenCalledWith('acp-12345678', expect.any(Function), expect.any(Function));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('toasts instead of archiving while the selected live runtime is still working', () => {
    store.projectSessions.mockReturnValue([{
      id: 'acp-12345678',
      projectId: 'p1',
      title: 'Architecture refactor',
      lifecycle: 'ready',
      updatedAt: '2026-08-13T10:00:00Z',
      lastOpenedAt: null,
      activeChatId: 'chat-live',
      archivedAt: null,
    }]);
    store.selectedSessionId.mockReturnValue('acp-12345678');
    store.chatStatusSignal.mockReturnValue({ 'chat-live': 'accepting' });
    store.turnActive.mockReturnValue(true);

    render(() => <ProjectSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive session' }));

    expect(store.toast).toHaveBeenCalledWith('This session is still loading. Close the running instance before archiving.');
    expect(store.archiveProjectSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('archives a selected session whose leftover turn is stale after the runtime is gone', () => {
    store.archiveProjectSession.mockReturnValue(true);
    store.projectSessions.mockReturnValue([{
      id: 'acp-12345678',
      projectId: 'p1',
      title: 'Architecture refactor',
      lifecycle: 'ready',
      updatedAt: '2026-08-13T10:00:00Z',
      lastOpenedAt: null,
      activeChatId: null,
      archivedAt: null,
    }]);
    store.selectedSessionId.mockReturnValue('acp-12345678');
    store.turnActive.mockReturnValue(true);
    store.chatTurnActiveSignal.mockReturnValue({ 'chat-gone': true });

    render(() => <ProjectSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive session' }));

    expect(store.toast).not.toHaveBeenCalled();
    expect(store.archiveProjectSession).toHaveBeenCalledWith('acp-12345678', expect.any(Function), expect.any(Function));
    expect(screen.queryByTestId('session-loading-wave')).not.toBeInTheDocument();
  });

  it('keeps archived sessions out of the workspace session list', () => {
    store.projectSessions.mockReturnValue([{
      id: 'acp-12345678',
      projectId: 'p1',
      title: 'Architecture refactor',
      lifecycle: 'ready',
      updatedAt: '2026-08-13T10:00:00Z',
      lastOpenedAt: null,
      activeChatId: null,
      archivedAt: '2026-08-14T00:00:00Z',
    }]);

    render(() => <ProjectSidebar />);
    expect(screen.queryByRole('button', { name: /^Architecture refactor/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Archived sessions/ })).not.toBeInTheDocument();
  });
});

describe('keyboard labels', () => {
  it('uses the visible platform modifier instead of claiming every user has Command', () => {
    const platform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux x86_64' });
    expect(primaryShortcut('k')).toBe('Ctrl+K');
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
    expect(primaryShortcut('k')).toBe('⌘K');
    Object.defineProperty(navigator, 'platform', { configurable: true, value: platform });
  });
});
