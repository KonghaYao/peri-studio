import { render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingElicitation, PendingPermission } from '../lib/control-view';
import type { ProjectInfo } from '../lib/registry-view';

const state = vi.hoisted(() => ({
  chatHead: vi.fn(() => null),
  createProjectSession: vi.fn(),
  creatingSessionProjectId: vi.fn(() => null),
  elicitationResponses: vi.fn(() => ({})),
  elicitations: vi.fn<() => PendingElicitation[]>(() => []),
  permissions: vi.fn<() => PendingPermission[]>(() => []),
  projects: vi.fn<() => ProjectInfo[]>(() => []),
  readOnly: vi.fn(() => false),
  refreshCurrentControlProjection: vi.fn(),
  registryHydrated: vi.fn(() => true),
  respondElicitation: vi.fn(),
  restoringSessionId: vi.fn(() => null as string | null),
  selectedSessionId: vi.fn(() => 'session-1' as string | null),
}));

vi.mock('../store', () => state);
vi.mock('../lib/auth-state', () => ({ readOnly: state.readOnly }));
vi.mock('./AgentActivityRail', () => ({ AgentActivityRail: () => null }));
vi.mock('./AgentPlanPanel', () => ({ AgentPlanPanel: () => null }));
vi.mock('./ChatHeader', () => ({ ChatHeader: () => null }));
vi.mock('./Composer', () => ({ Composer: () => null }));
vi.mock('./ConnectionProblem', () => ({ ConnectionProblem: () => null }));
vi.mock('./ElicitationQueue', () => ({ ElicitationQueue: () => <section aria-label="Agent question" /> }));
vi.mock('./ErrorCenter', () => ({ ErrorCenter: () => null }));
vi.mock('./MessageList', () => ({ MessageList: () => null }));
vi.mock('./QuickStartComposer', () => ({ QuickStartComposer: () => <section aria-label="Start new session" class="quick-start quick-start--docked" /> }));

import { ChatView } from './ChatView';

afterEach(() => {
  state.projects.mockReturnValue([]);
  state.permissions.mockReturnValue([]);
  state.registryHydrated.mockReturnValue(true);
  state.restoringSessionId.mockReturnValue(null);
  state.selectedSessionId.mockReturnValue('session-1');
});

describe('ChatView project directory hydration', () => {
  it('keeps an unknown registry in a loading state instead of inferring an empty directory', () => {
    state.selectedSessionId.mockReturnValue(null);
    state.registryHydrated.mockReturnValue(false);
    state.projects.mockReturnValue([]);

    render(() => <ChatView />);

    expect(screen.getByRole('status', { name: 'Loading projects' })).toBeInTheDocument();
    expect(screen.queryByText('Start with a clear prompt')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument();
  });

  it('shows the project empty state only after the registry confirms it is empty', () => {
    state.selectedSessionId.mockReturnValue(null);
    state.projects.mockReturnValue([]);

    render(() => <ChatView />);

    expect(screen.getByText('Start with a clear prompt')).toBeInTheDocument();
    expect(screen.getByText('Create a project first; Peri Studio saves and restores ACP sessions within it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading projects' })).not.toBeInTheDocument();
  });

  it('presents an unselected project directory as a Codex-style launch workspace', () => {
    state.selectedSessionId.mockReturnValue(null);
    state.projects.mockReturnValue([{
      id: 'project-1', name: 'Peri Studio', cwd: '/repo', instanceId: 'local',
      createdAt: '2026-08-13T10:00:00Z', updatedAt: '2026-08-13T10:00:00Z', archivedAt: null,
    }]);

    render(() => <ChatView />);

    expect(screen.getByRole('heading', { name: 'What do you want to build in Peri Studio?' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Start new session' })).toHaveClass('quick-start--docked');
    expect(document.querySelector('.chat-view')).toHaveClass('chat-view--launch');
  });

  it('keeps an archived-only registry distinct from an empty directory', () => {
    state.selectedSessionId.mockReturnValue(null);
    state.projects.mockReturnValue([{
      id: 'project-1', name: 'Archived project', cwd: '/repo', instanceId: 'local',
      createdAt: '2026-08-13T10:00:00Z', updatedAt: '2026-08-13T10:00:00Z', archivedAt: '2026-08-14T10:00:00Z',
    }]);

    render(() => <ChatView />);

    expect(screen.getByText('Restore an archived project or create a new project to continue.')).toBeInTheDocument();
    expect(screen.queryByText('Create a project first; Peri Studio saves and restores ACP sessions within it.')).not.toBeInTheDocument();
  });
});

describe('ChatView feedback', () => {
  it('uses the shared loading live region while restoring a session', () => {
    state.restoringSessionId.mockReturnValue('session-1');
    render(() => <ChatView />);

    const status = screen.getByRole('status', { name: 'Restoring last session and ACP context…' });
    expect(status).toHaveClass('restore-banner');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Restoring last session and ACP context…');
    expect(status.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('shows only the blocking permission surface when permission and elicitation coexist', () => {
    state.elicitations.mockReturnValue([{
      elicitationId: 'ask-1', message: 'Choose an approach', status: 'pending', responseAction: null,
      createdAt: null, fields: [],
    }]);
    state.permissions.mockReturnValue([{
      queueKey: 'permission-1', permissionId: 'permission-1', turnId: 'turn-1', toolCallId: 'tool-1', title: 'Edit file',
      description: null, options: ['allowOnce', 'deny'], status: 'pending', decision: null,
    }]);
    render(() => <ChatView />);

    expect(screen.queryByRole('region', { name: 'Agent question' })).not.toBeInTheDocument();
  });
});
