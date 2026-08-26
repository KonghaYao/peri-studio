import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  setChatHead,
  setChatStatusSignal,
  setInstances,
  setOpeningSession,
  setPermissions,
  setProjectSessions,
  setRuntimeDocsState,
  setSelectedCid,
  setSelectedSessionId,
} from '../store';
import { setConnState } from '../lib/connection';
import { ChatHeader } from './ChatHeader';
import { resetRuntimeControls, startRuntimeControl } from '../lib/runtime-control';
import { setPrincipalRole } from '../lib/auth-state';

const session = {
  id: 'session-1',
  projectId: 'project-1',
  acpSessionId: 'acp-1',
  title: 'Persistent session',
  lifecycle: 'ready',
  updatedAt: null,
  lastOpenedAt: null,
  activeChatId: 'chat-1',
};

function resetStore() {
  setProjectSessions([]);
  setSelectedSessionId(null);
  setSelectedCid(null);
  setOpeningSession(null);
  setChatStatusSignal({});
  setChatHead(null);
  setPermissions([]);
  setRuntimeDocsState({ chat: false, control: false });
  setConnState({ text: 'Disconnected', kind: 'idle' });
  resetRuntimeControls();
  setPrincipalRole(null);
  setInstances([]);
}

afterEach(resetStore);

describe('ChatHeader runtime truth', () => {
  it('exposes rewind only when the active Agent negotiated the exact Peri capability', async () => {
    setPrincipalRole('full');
    setProjectSessions([session]);
    setSelectedSessionId(session.id);
    setSelectedCid('chat-1');
    setChatStatusSignal({ 'chat-1': 'active' });
    setConnState({ text: 'Ready', kind: 'ok' });
    setChatHead({
      chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null },
      agent: {
        instanceId: 'local', sessionId: 'acp-1', status: 'ready', lastActivityAt: null,
        availableCommands: [], commandCatalog: [], extensions: [], activities: [], inputPrediction: null,
        latestUsage: null, model: null, effort: null, contextWindow: null, contextUsed: null,
      },
      activeTurn: null, pendingPermissions: [],
    });
    render(() => <ChatHeader />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Conversation actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Rewind session…' })).not.toBeInTheDocument();

    setChatHead((current) => current?.agent ? {
      ...current, agent: { ...current.agent, extensions: ['peri.rewind'] },
    } : current);
    if (!screen.queryByRole('menuitem', { name: 'Rewind session…' })) {
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Conversation actions' }));
    }
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Rewind session…' })).toBeInTheDocument());
  });

  it('keeps durable session identity separate from an absent runtime', () => {
    setProjectSessions([{ ...session, activeChatId: null }]);
    setSelectedSessionId(session.id);
    render(() => <ChatHeader />);

    expect(screen.getByText('Persistent session')).toBeInTheDocument();
    expect(screen.getByText('Idle')).toBeInTheDocument();
  });

  it('disambiguates a fallback title with the durable ACP identity', () => {
    setProjectSessions([{ ...session, title: 'New conversation', acpSessionId: 'acp-12345678', activeChatId: null }]);
    setSelectedSessionId(session.id);
    render(() => <ChatHeader />);

    expect(screen.getByText('New conversation · …12345678')).toBeInTheDocument();
  });

  it('leaves permission attention to the actionable permission card', () => {
    setProjectSessions([session]);
    setSelectedSessionId(session.id);
    setSelectedCid('chat-1');
    setChatStatusSignal({ 'chat-1': 'active' });
    setRuntimeDocsState({ chat: false, control: true });
    setConnState({ text: 'Ready', kind: 'ok' });
    setChatHead({
      chat: { chatId: 'chat-1', title: session.title, status: 'active', activeTurnId: 'turn-1', createdAt: null, updatedAt: null },
      agent: null,
      activeTurn: { turnId: 'turn-1', turnStatus: 'running', updatedAt: null },
      pendingPermissions: [],
    });
    setPermissions([{ queueKey: 'permission-1', permissionId: 'permission-1', turnId: 'turn-1', toolCallId: 'tool-1', title: 'Shell', description: null, options: ['allowOnce', 'deny'], status: 'pending', decision: null }]);
    setConnState({ text: 'Ready', kind: 'ok' });
    render(() => <ChatHeader />);

    expect(screen.queryByText('Approval')).not.toBeInTheDocument();
    expect(screen.queryByText('Working')).not.toBeInTheDocument();
  });

  it('states that a crashed runtime did not delete the session', () => {
    setProjectSessions([session]);
    setSelectedSessionId(session.id);
    setSelectedCid('chat-1');
    setChatStatusSignal({ 'chat-1': 'crashed' });
    render(() => <ChatHeader />);

    const status = screen.getByText('Crashed');
    expect(status.closest('.runtime-status')).toHaveClass('runtime-status--danger');
  });

  it('does not announce input readiness before runtime hydration completes', () => {
    setProjectSessions([session]);
    setSelectedSessionId(session.id);
    setSelectedCid('chat-1');
    setChatStatusSignal({ 'chat-1': 'active' });
    setRuntimeDocsState({ chat: true, control: false });
    setConnState({ text: 'Ready', kind: 'ok' });
    render(() => <ChatHeader />);

    expect(screen.getByText('Loading')).toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  });

  it('does not advertise input readiness after the browser connection stops', () => {
    setProjectSessions([session]);
    setSelectedSessionId(session.id);
    setSelectedCid('chat-1');
    setChatStatusSignal({ 'chat-1': 'active' });
    setRuntimeDocsState({ chat: true, control: true });
    setConnState({ text: 'Stopped (4501)', kind: 'err' });
    render(() => <ChatHeader />);

    expect(screen.getByText('Offline', { selector: '.runtime-status .sr-only' }).closest('.runtime-status')).toHaveClass('runtime-status--danger');
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  });

  it('prevents close while another control owns the runtime', () => {
    setProjectSessions([session]);
    setSelectedSessionId(session.id);
    setSelectedCid('chat-1');
    setChatStatusSignal({ 'chat-1': 'active' });
    startRuntimeControl('cancel-1', 'chat-1', 'cancel');
    render(() => <ChatHeader />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Conversation actions' }));
    expect(screen.getByRole('menuitem', { name: 'Close running instance' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('closes the confirmation when Registry proves the runtime is terminal', async () => {
    setPrincipalRole('full');
    setProjectSessions([session]);
    setSelectedSessionId(session.id);
    setSelectedCid('chat-1');
    setChatStatusSignal({ 'chat-1': 'active' });
    render(() => <ChatHeader />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Conversation actions' }));
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Close running instance' }), { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    setChatStatusSignal({ 'chat-1': 'closed' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('delegates the system information entry to the application shell', () => {
    const onOpenSystem = vi.fn();
    render(() => <ChatHeader onOpenSystem={onOpenSystem} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open system information' }));
    expect(onOpenSystem).toHaveBeenCalledOnce();
  });
});
