import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { setChatHead, setChatStatusSignal, setOpeningSession, setProjectSessions, setSelectedCid, setSelectedSessionId } from '../store';
import { setPrincipalRole } from '../lib/auth-state';
import { resetRuntimeControls, startRuntimeControl } from '../lib/runtime-control';
import { SessionRailActions } from './SessionRailActions';

const session = {
  id: 'session-1', projectId: 'project-1', acpSessionId: 'acp-1', title: 'Persistent session',
  lifecycle: 'ready', updatedAt: null, lastOpenedAt: null, activeChatId: 'chat-1',
};

function prepare(extensions: string[] = []) {
  setPrincipalRole('full');
  setProjectSessions([session]);
  setSelectedSessionId(session.id);
  setSelectedCid('chat-1');
  setChatStatusSignal({ 'chat-1': 'active' });
  setChatHead({
    chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null },
    agent: {
      instanceId: 'local', sessionId: 'acp-1', status: 'ready', lastActivityAt: null,
      availableCommands: [], commandCatalog: [], extensions, activities: [], inputPrediction: null,
      latestUsage: null, model: null, effort: null, contextWindow: null, contextUsed: null,
    },
    activeTurn: null, pendingPermissions: [],
  });
}

afterEach(() => {
  setProjectSessions([]);
  setSelectedSessionId(null);
  setSelectedCid(null);
  setOpeningSession(null);
  setChatStatusSignal({});
  setChatHead(null);
  setPrincipalRole(null);
  resetRuntimeControls();
});

describe('SessionRailActions', () => {
  it('places negotiated rewind and runtime close on the resource rail', () => {
    prepare(['peri.rewind']);
    render(() => <SessionRailActions />);

    expect(screen.getByRole('button', { name: 'Rewind session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close running instance' })).toBeInTheDocument();
  });

  it('prevents close while another control owns the runtime', () => {
    prepare();
    startRuntimeControl('cancel-1', 'chat-1', 'cancel');
    render(() => <SessionRailActions />);

    expect(screen.getByRole('button', { name: 'Close running instance' })).toBeDisabled();
  });

  it('closes confirmation and exposes reopen when Registry proves terminal state', async () => {
    prepare();
    render(() => <SessionRailActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Close running instance' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    setChatStatusSignal({ 'chat-1': 'closed' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Reopen session' })).toBeInTheDocument();
  });
});
