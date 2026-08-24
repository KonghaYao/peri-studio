import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPrincipalRole } from '../lib/auth-state';
import {
  setInstances,
  setPermissions,
  setProjects,
  setProjectSessions,
  setRegistryHydrated,
  setRuntimeDocsState,
  setSelectedCid,
  setSelectedSessionId,
} from '../store';
import { ProjectSidebar } from './ProjectSidebar';

const instance = (heartbeat: string) => ({
  id: 'local', hostname: 'Local machine', status: 'online', tokenId: null,
  registeredAt: null, lastHeartbeat: heartbeat, chatCount: 0,
});

describe('ProjectSidebar structural identity', () => {
  beforeEach(() => {
    installPrincipalRole('full');
    setRegistryHydrated(true);
    setInstances([instance('first')]);
    setProjects([{
      id: 'project-1', name: 'Peri', cwd: '/workspace/peri', instanceId: 'local',
      createdAt: null, updatedAt: null, archivedAt: null,
    }]);
    setProjectSessions([{
      id: 'session-1', projectId: 'project-1', acpSessionId: 'acp-1', title: 'Architecture refactor',
      lifecycle: 'ready', updatedAt: null, lastOpenedAt: null, activeChatId: null, archivedAt: null,
    }]);
    setPermissions([]);
    setSelectedCid(null);
    setSelectedSessionId(null);
    setRuntimeDocsState({ chat: true, control: true });
  });

  afterEach(() => {
    setInstances([]);
    setProjects([]);
    setProjectSessions([]);
    setRegistryHydrated(false);
  });

  it('preserves a focused rename draft across machine and project metadata updates', async () => {
    render(() => <ProjectSidebar />);
    const row = document.querySelector('[data-session-id="session-1"]')!;
    const menu = screen.getByRole('button', { name: 'Session actions: Architecture refactor' });
    fireEvent.pointerDown(menu, { button: 0 });
    fireEvent.click(menu);
    const rename = await screen.findByText('Rename session');
    fireEvent.pointerUp(rename, { button: 0 });
    fireEvent.click(rename);
    const input = await screen.findByRole('textbox', { name: 'Session name' });
    fireEvent.input(input, { target: { value: 'Unsubmitted draft' } });
    input.focus();

    setInstances([instance('second')]);

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Session name' })).toHaveValue('Unsubmitted draft'));
    expect(document.querySelector('[data-session-id="session-1"]')).toBe(row);
    expect(screen.getByRole('textbox', { name: 'Session name' })).toBe(input);
    expect(document.activeElement).toBe(input);

    setInstances([{ ...instance('third'), hostname: 'Renamed machine', status: 'offline' }]);
    setProjects([{
      id: 'project-1', name: 'Peri renamed', cwd: '/workspace/peri', instanceId: 'local',
      createdAt: null, updatedAt: 'third', archivedAt: null,
    }]);

    await waitFor(() => expect(screen.getByText('Peri renamed')).toBeInTheDocument());
    expect(screen.getByText('Renamed machine')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Machine offline' })).toBeInTheDocument();
    expect(document.querySelector('[data-session-id="session-1"]')).toBe(row);
    expect(screen.getByRole('textbox', { name: 'Session name' })).toBe(input);
    expect(input).toHaveValue('Unsubmitted draft');
    expect(document.activeElement).toBe(input);
  });
});
