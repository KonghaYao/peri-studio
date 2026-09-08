import { render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
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
} from '@/store';
import { setConnState } from '@/features/connection/connection';
import { ChatHeader } from './ChatHeader';
import { resetRuntimeControls } from '@/features/runtime/runtime-control';
import { setPrincipalRole } from '@/features/auth/auth-state';

const session = {
  id: 'acp-1',
  projectId: 'project-1',
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

describe('ChatHeader', () => {
  it('keeps durable session identity separate from an absent runtime', () => {
    setProjectSessions([{ ...session, activeChatId: null }]);
    setSelectedSessionId(session.id);
    render(() => <ChatHeader />);

    expect(screen.getByText('Persistent session')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('disambiguates a fallback title with the durable ACP identity', () => {
    setProjectSessions([{ ...session, title: 'New conversation', id: 'acp-12345678', activeChatId: null }]);
    setSelectedSessionId('acp-12345678');
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
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps system information out of the per-conversation header', () => {
    render(() => <ChatHeader />);
    expect(screen.queryByRole('button', { name: 'Open system information' })).not.toBeInTheDocument();
  });
});
