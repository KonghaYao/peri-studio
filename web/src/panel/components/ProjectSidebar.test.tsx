import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  archiveProject: vi.fn(),
  archiveProjectSession: vi.fn(),
  chatStatusSignal: vi.fn(() => ({})),
  connState: vi.fn(() => ({ kind: 'ok', text: 'Connected' })),
  createProject: vi.fn(),
  createProjectSession: vi.fn(),
  creatingSessionProjectId: vi.fn(() => null as string | null),
  discoverProjectSessions: vi.fn(() => true),
  discoveringSessionsProjectId: vi.fn(() => null as string | null),
  importableSessions: vi.fn(() => []),
  importProjectSession: vi.fn(),
  instances: vi.fn(() => [{ id: 'local', hostname: 'Local instance', status: 'online' }]),
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
    id: 'hub-abcdef12',
    projectId: 'p1',
    title: 'Architecture refactor',
    lifecycle: 'ready',
    updatedAt: '2026-08-13T10:00:00Z',
    lastOpenedAt: null,
    activeChatId: null as string | null,
    acpSessionId: 'acp-12345678',
    archivedAt: null as string | null,
  }]),
  readOnly: vi.fn(() => false),
  runtimeDocsHydrated: vi.fn(() => true),
  renameProject: vi.fn(),
  renameProjectSession: vi.fn(),
  restoreProject: vi.fn(),
  restoreProjectSession: vi.fn(),
  selectedCid: vi.fn(() => null as string | null),
  selectedSessionId: vi.fn(() => null as string | null),
  turnActive: vi.fn(() => false),
}));

vi.mock('../store', () => store);
vi.mock('../lib/auth-state', () => ({ readOnly: store.readOnly }));
vi.mock('./AuthGate', () => ({ useAuthActions: () => ({ logout: vi.fn() }) }));

import { ProjectSidebar } from './ProjectSidebar';
import { primaryShortcut } from '../lib/keyboard';

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
    expect(screen.queryByRole('button', { name: /New project on/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Search sessions/ })).toBeDisabled();
  });

  it('shows connected instances without inventing an empty project directory', () => {
    store.projects.mockReturnValue([]);

    render(() => <ProjectSidebar />);

    expect(screen.getByText('Local instance')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New project on Local instance unavailable: choose a remote directory first/ })).toBeDisabled();
    expect(screen.queryByText('No projects yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Root workspace')).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading projects' })).not.toBeInTheDocument();
  });

  it('keeps archived projects separate while retaining their instance', () => {
    store.projects.mockReturnValue([{ id: 'archived', name: 'Archived project', cwd: '/repo', instanceId: 'local', createdAt: '2026-08-13T10:00:00Z', updatedAt: '2026-08-13T10:00:00Z', archivedAt: '2026-08-14T10:00:00Z' }]);

    render(() => <ProjectSidebar />);

    expect(screen.getByText('Local instance')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archived project' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Archived\s*1/ })).toBeInTheDocument();
  });
  it('renders an offline instance without projects and exposes its offline state', () => {
    store.projects.mockReturnValue([]);
    store.instances.mockReturnValue([{ id: 'remote', hostname: 'Remote instance', status: 'offline' }]);

    render(() => <ProjectSidebar />);

    expect(screen.getByText('Remote instance')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Instance offline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New project on Remote instance unavailable: choose a remote directory first/ })).toBeDisabled();
  });

  beforeEach(() => {
    store.registryHydrated.mockReturnValue(true);
    store.projects.mockReturnValue([{ id: 'p1', name: 'Perihelion', cwd: '/repo', instanceId: 'local', createdAt: '2026-08-13T10:00:00Z', updatedAt: '2026-08-13T10:00:00Z', archivedAt: null }]);
    store.navigateProjectSession.mockReset();
    store.openingSessionId.mockReturnValue(null);
    store.readOnly.mockReturnValue(false);
    store.selectedSessionId.mockReturnValue(null);
    store.selectedCid.mockReturnValue(null);
    store.projectSessions.mockReturnValue([{
      id: 'hub-abcdef12',
      projectId: 'p1',
      title: 'Architecture refactor',
      lifecycle: 'ready',
      updatedAt: '2026-08-13T10:00:00Z',
      lastOpenedAt: null,
      activeChatId: null,
      acpSessionId: 'acp-12345678',
      archivedAt: null,
    }]);
  });

  it('uses a controlled disclosure for project sessions', () => {
    render(() => <ProjectSidebar />);
    const disclosure = screen.getByRole('button', { name: 'Perihelion' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
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

    expect(store.navigateProjectSession).toHaveBeenCalledWith('hub-abcdef12', expect.any(Object));
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
      id: 'hub-abcdef12',
      projectId: 'p1',
      title: 'Architecture refactor',
      lifecycle: 'ready',
      updatedAt: '2026-08-13T10:00:00Z',
      lastOpenedAt: null,
      activeChatId: 'chat-live',
      acpSessionId: 'acp-12345678',
      archivedAt: null,
    }]);

    render(() => <ProjectSidebar onNavigate={navigate} />);
    fireEvent.click(sessionButton());

    expect(store.navigateProjectSession).toHaveBeenCalledWith('hub-abcdef12');
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('describes an unselected live runtime as switchable, not input-ready', () => {
    store.projectSessions.mockReturnValue([{
      id: 'hub-abcdef12',
      projectId: 'p1',
      title: 'Architecture refactor',
      lifecycle: 'ready',
      updatedAt: '2026-08-13T10:00:00Z',
      lastOpenedAt: null,
      activeChatId: 'chat-live',
      acpSessionId: 'acp-12345678',
      archivedAt: null,
    }]);

    render(() => <ProjectSidebar />);

    expect(screen.getByRole('img', { name: 'Runtime status: Running · click to switch' })).toBeInTheDocument();
    expect(screen.queryByText(/Ready/)).not.toBeInTheDocument();
  });

  it('keeps archived sessions out of normal navigation and restores them explicitly', () => {
    let commit = () => {};
    store.restoreProjectSession.mockImplementation((_id, onCommitted) => { commit = onCommitted; return true; });
    store.projectSessions.mockReturnValue([{
      id: 'hub-abcdef12',
      projectId: 'p1',
      title: 'Architecture refactor',
      lifecycle: 'ready',
      updatedAt: '2026-08-13T10:00:00Z',
      lastOpenedAt: null,
      activeChatId: null,
      acpSessionId: 'acp-12345678',
      archivedAt: '2026-08-14T00:00:00Z',
    }]);

    render(() => <ProjectSidebar />);
    expect(screen.queryByRole('button', { name: /^Architecture refactor/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Archived sessions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(store.restoreProjectSession).toHaveBeenCalledWith('hub-abcdef12', expect.any(Function), expect.any(Function));
    commit();
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
