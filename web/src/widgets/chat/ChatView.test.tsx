import { render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingElicitation, PendingPermission, PendingQuestion } from '@/entities/chat/control-view';
import type { ProjectInfo } from '@/entities/registry/registry-view';

const state = vi.hoisted(() => ({
  chatCatalog: vi.fn(() => []),
  chatEntries: vi.fn(() => [] as never[]),
  chatHead: vi.fn(() => null),
  chatAgentLoading: vi.fn(() => false),
  createProjectSession: vi.fn(),
  creatingSessionProjectId: vi.fn(() => null),
  elicitationResponses: vi.fn(() => ({})),
  elicitations: vi.fn<() => PendingElicitation[]>(() => []),
  questions: vi.fn<() => PendingQuestion[]>(() => []),
  questionResponses: vi.fn(() => ({})),
  permissions: vi.fn<() => PendingPermission[]>(() => []),
  projects: vi.fn<() => ProjectInfo[]>(() => []),
  readOnly: vi.fn(() => false),
  refreshCurrentControlProjection: vi.fn(),
  resolvePermission: vi.fn(),
  registryHydrated: vi.fn(() => true),
  respondElicitation: vi.fn(),
  respondQuestion: vi.fn(),
  retryPersistentAction: vi.fn(),
  restoringSessionId: vi.fn(() => null as string | null),
  runtimeDocsHydrated: vi.fn(() => true),
  selectedCid: vi.fn(() => null),
  selectedSessionId: vi.fn(() => 'session-1' as string | null),
  turnActive: vi.fn(() => false),
}));

vi.mock('@/store', () => state);
vi.mock('@/features/auth/auth-state', () => ({ readOnly: state.readOnly }));
vi.mock('@/widgets/shell/StatusArea', () => ({ StatusArea: () => <section aria-label="Status area" /> }));
vi.mock('./ChatHeader', () => ({ ChatHeader: () => null }));
vi.mock('@/widgets/composer/Composer', () => ({ Composer: () => null }));
vi.mock('@/widgets/shell/ConnectionProblem', () => ({ ConnectionProblem: () => null }));
vi.mock('./ElicitationQueue', () => ({ ElicitationQueue: () => <section aria-label="Agent question" /> }));
vi.mock('./QuestionQueue', () => ({ QuestionQueue: () => <section aria-label="Ask user question" /> }));
vi.mock('./PermissionQueue', () => ({ PermissionQueue: () => <section aria-label="Permissions" /> }));
vi.mock('@/widgets/shell/ErrorCenter', () => ({ ErrorCenter: () => null }));
vi.mock('./MessageList', () => ({ MessageList: () => null }));
vi.mock('@/widgets/composer/QuickStartComposer', () => ({ QuickStartComposer: () => <section aria-label="Start new session" data-testid="quick-start-docked" class="quick-start quick-start--docked" /> }));

import { ChatView } from './ChatView';

afterEach(() => {
  state.chatCatalog.mockReturnValue([]);
  state.projects.mockReturnValue([]);
  state.permissions.mockReturnValue([]);
  state.registryHydrated.mockReturnValue(true);
  state.restoringSessionId.mockReturnValue(null);
  state.selectedCid.mockReturnValue(null);
  state.selectedSessionId.mockReturnValue('session-1');
});

describe('ChatView project directory hydration', () => {
  it('keeps an unknown registry in a loading state instead of inferring an empty directory', () => {
    state.selectedSessionId.mockReturnValue(null);
    state.registryHydrated.mockReturnValue(false);
    state.projects.mockReturnValue([]);

    render(() => <ChatView />);

    expect(screen.getByRole('status', { name: 'Loading projects' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What would you like to do today?' })).not.toBeInTheDocument();
  });

  it('shows the project empty state only after the registry confirms it is empty', () => {
    state.selectedSessionId.mockReturnValue(null);
    state.projects.mockReturnValue([]);

    render(() => <ChatView />);

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

    expect(screen.getByTestId('chat-empty-workspace')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What do you want to build?' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Start new session' })).toHaveAttribute('data-testid', 'quick-start-docked');
    expect(screen.getByTestId('chat-view')).toHaveClass('chat-view--launch');
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

    const status = screen.getByTestId('restore-banner');
    expect(status).toHaveClass('restore-banner');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Restoring last session and ACP context…');
    expect(status.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('shows permission, elicitation, and question surfaces in parallel when all are pending', () => {
    state.elicitations.mockReturnValue([{
      elicitationId: 'ask-1', message: 'Choose an approach', status: 'pending', responseAction: null,
      createdAt: null, fields: [],
    }]);
    state.permissions.mockReturnValue([{
      queueKey: 'permission-1', permissionId: 'permission-1', turnId: 'turn-1', toolCallId: 'tool-1', title: 'Edit file',
      description: null, options: ['allowOnce', 'deny'], status: 'pending', decision: null,
    }]);
    state.questions.mockReturnValue([{
      questionId: 'q-1',
      status: 'pending',
      description: null,
      expiresAt: null,
      questions: [{
        question: 'Pick one',
        header: null,
        multiSelect: false,
        options: [{ label: 'A', description: null }],
      }],
    }]);
    render(() => <ChatView />);

    expect(screen.getByRole('region', { name: 'Permissions' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Agent question' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Ask user question' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Status area' })).toBeInTheDocument();
  });

  it('keeps the status area visible while a permission prompt is open', () => {
    state.permissions.mockReturnValue([{
      queueKey: 'permission-1', permissionId: 'permission-1', turnId: 'turn-1', toolCallId: 'tool-1', title: 'Edit file',
      description: null, options: ['allowOnce', 'deny'], status: 'pending', decision: null,
    }]);
    state.questions.mockReturnValue([{
      questionId: 'q-1',
      status: 'pending',
      description: null,
      expiresAt: null,
      questions: [{
        question: 'Pick one',
        header: null,
        multiSelect: false,
        options: [{ label: 'A', description: null }],
      }],
    }]);

    render(() => <ChatView />);

    expect(screen.getByRole('region', { name: 'Permissions' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Ask user question' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Status area' })).toBeInTheDocument();
  });
});
