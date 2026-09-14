import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { ResourceWorkbench, type WorkbenchView } from './ResourceWorkbench';
import {
  installResourceStore,
  resetResourceProject,
} from '@/features/resource/resource-store';
import { setProjects, setProjectSessions, setSelectedSessionId } from '@/store';

const terminalMocks = vi.hoisted(() => ({
  closeTerminal: vi.fn(),
}));

vi.mock('@/features/terminal/terminal-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/terminal/terminal-session')>();
  return {
    ...actual,
    terminalSession: () => ({
      phase: 'running' as const,
      requestId: 'req-1',
      terminalId: 'term-1',
      projectId: 'project-1',
      projectName: 'Peri',
      cwd: '/workspace',
      error: null,
      retryable: false,
      exitCode: null,
      signal: null,
      cols: 80,
      rows: 24,
    }),
    closeTerminal: (...args: unknown[]) => terminalMocks.closeTerminal(...args),
    attachTerminalOutput: vi.fn(),
    detachTerminalOutput: vi.fn(),
    openTerminal: vi.fn(() => true),
    sendTerminalInput: vi.fn(),
    sendTerminalBinaryInput: vi.fn(),
    resizeTerminal: vi.fn(),
  };
});

vi.mock('@peri/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@peri/ui')>();
  return {
    ...actual,
    Terminal: () => null,
  };
});

afterEach(() => {
  cleanup();
  resetResourceProject();
  setProjects([]);
  setProjectSessions([]);
  setSelectedSessionId(null);
  terminalMocks.closeTerminal.mockReset();
  vi.unstubAllGlobals();
});

describe('ResourceWorkbench compact terminal surface', () => {
  it('parks the terminal panel when compact view leaves terminal without closing the session', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
    installResourceStore({ send: vi.fn(() => true), ready: () => true, toast: vi.fn() });
    setProjects([{ id: 'project-1', name: 'Peri', cwd: '/workspace/peri', instanceId: 'local', createdAt: null, updatedAt: null, archivedAt: null }]);
    setProjectSessions([{ id: 'session-1', projectId: 'project-1', acpSessionId: 'acp-1', title: 'Work', lifecycle: 'ready', updatedAt: null, lastOpenedAt: null, activeChatId: null, archivedAt: null }]);
    setSelectedSessionId('session-1');
    const [view, setView] = createSignal<WorkbenchView>('terminal');
    render(() => (
      <ResourceWorkbench
        compact
        open
        view={view()}
        onViewChange={(next) => setView(next)}
      />
    ));

    await fireEvent.click(screen.getByRole('button', { name: 'Explorer' }));
    expect(screen.getByTestId('terminal-parked-panel')).toBeInTheDocument();
    expect(terminalMocks.closeTerminal).not.toHaveBeenCalled();
  });

  it('closes the terminal and shows a notice when the active project changes', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
    installResourceStore({ send: vi.fn(() => true), ready: () => true, toast: vi.fn() });
    setProjects([
      { id: 'project-1', name: 'Peri', cwd: '/workspace/peri', instanceId: 'local', createdAt: null, updatedAt: null, archivedAt: null },
      { id: 'project-2', name: 'Other', cwd: '/workspace/other', instanceId: 'local', createdAt: null, updatedAt: null, archivedAt: null },
    ]);
    setProjectSessions([
      { id: 'session-1', projectId: 'project-1', acpSessionId: 'acp-1', title: 'Work', lifecycle: 'ready', updatedAt: null, lastOpenedAt: null, activeChatId: null, archivedAt: null },
      { id: 'session-2', projectId: 'project-2', acpSessionId: 'acp-2', title: 'Other', lifecycle: 'ready', updatedAt: null, lastOpenedAt: null, activeChatId: null, archivedAt: null },
    ]);
    setSelectedSessionId('session-1');
    const [view, setView] = createSignal<WorkbenchView>('explorer');
    render(() => (
      <ResourceWorkbench
        compact
        open
        view={view()}
        onViewChange={(next) => setView(next)}
      />
    ));

    setSelectedSessionId('session-2');
    await Promise.resolve();

    expect(terminalMocks.closeTerminal).toHaveBeenCalled();
    expect(screen.getByText(/Terminal closed because the project changed/i)).toBeInTheDocument();
  });
});
