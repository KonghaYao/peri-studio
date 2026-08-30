import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { ArchivedBrowserDialog } from './ArchivedBrowserDialog';

const store = vi.hoisted(() => ({
  projects: vi.fn<() => Array<{
    id: string;
    name: string;
    cwd: string;
    instanceId: string;
    createdAt: string;
    updatedAt: string;
    archivedAt: string | null;
  }>>(() => []),
  projectSessions: vi.fn<() => Array<{
    id: string;
    projectId: string;
    title: string;
    lifecycle: string;
    updatedAt: string;
    lastOpenedAt: string | null;
    activeChatId: string | null;
    archivedAt: string | null;
  }>>(() => []),
}));

vi.mock('../../panel/store', () => ({
  projects: store.projects,
  projectSessions: store.projectSessions,
}));

describe('ArchivedBrowserDialog', () => {
  it('lists archived projects and sessions with search filtering', () => {
    store.projects.mockReturnValue([
      {
        id: 'p-archived',
        name: 'Old workspace',
        cwd: '/old',
        instanceId: 'local',
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-10T00:00:00Z',
        archivedAt: '2026-08-12T00:00:00Z',
      },
    ]);
    store.projectSessions.mockReturnValue([
      {
        id: 'acp-archived',
        projectId: 'p-active',
        title: 'Spike notes',
        lifecycle: 'ready',
        updatedAt: '2026-08-11T00:00:00Z',
        lastOpenedAt: null,
        activeChatId: null,
        archivedAt: '2026-08-13T00:00:00Z',
      },
    ]);

    render(() => (
      <ArchivedBrowserDialog
        open
        onClose={() => {}}
        readOnly={false}
        restoringProjectId={null}
        restoringSessionId={null}
        onRestoreProject={vi.fn()}
        onRestoreSession={vi.fn()}
      />
    ));

    expect(screen.getByText('Old workspace')).toBeInTheDocument();
    expect(screen.getByText('Spike notes')).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText('Search archived projects and sessions'), {
      target: { value: 'spike' },
    });

    expect(screen.queryByText('Old workspace')).not.toBeInTheDocument();
    expect(screen.getByText('Spike notes')).toBeInTheDocument();
  });

  it('restores archived sessions from the dialog', () => {
    const onRestoreSession = vi.fn();
    store.projects.mockReturnValue([]);
    store.projectSessions.mockReturnValue([
      {
        id: 'acp-archived',
        projectId: 'p1',
        title: 'Architecture refactor',
        lifecycle: 'ready',
        updatedAt: '2026-08-11T00:00:00Z',
        lastOpenedAt: null,
        activeChatId: null,
        archivedAt: '2026-08-13T00:00:00Z',
      },
    ]);

    render(() => (
      <ArchivedBrowserDialog
        open
        onClose={() => {}}
        readOnly={false}
        restoringProjectId={null}
        restoringSessionId={null}
        onRestoreProject={vi.fn()}
        onRestoreSession={onRestoreSession}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onRestoreSession).toHaveBeenCalledWith('acp-archived');
  });

  it('scopes archived sessions to a workspace', () => {
    store.projects.mockReturnValue([]);
    store.projectSessions.mockReturnValue([
      {
        id: 'acp-archived',
        projectId: 'p-active',
        title: 'Spike notes',
        lifecycle: 'ready',
        updatedAt: '2026-08-11T00:00:00Z',
        lastOpenedAt: null,
        activeChatId: null,
        archivedAt: '2026-08-13T00:00:00Z',
      },
      {
        id: 'acp-other',
        projectId: 'p-other',
        title: 'Other notes',
        lifecycle: 'ready',
        updatedAt: '2026-08-11T00:00:00Z',
        lastOpenedAt: null,
        activeChatId: null,
        archivedAt: '2026-08-13T00:00:00Z',
      },
    ]);

    render(() => (
      <ArchivedBrowserDialog
        open
        onClose={() => {}}
        projectId="p-active"
        projectName="Active"
        readOnly={false}
        restoringProjectId={null}
        restoringSessionId={null}
        onRestoreProject={vi.fn()}
        onRestoreSession={vi.fn()}
      />
    ));

    expect(screen.getByText('Active · Archived')).toBeInTheDocument();
    expect(screen.getByText('Spike notes')).toBeInTheDocument();
    expect(screen.queryByText('Other notes')).not.toBeInTheDocument();
  });
});
