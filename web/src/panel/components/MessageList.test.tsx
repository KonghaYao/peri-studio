import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setChatEntries, setChatHead, setElicitations, setPermissions, setRuntimeDocsState } from '../store';
import { MessageList } from './MessageList';
import type { ChatEntry } from '../lib/chat-view';

function message(id: string, origin: ChatEntry['origin'], replayVerified: boolean | null): ChatEntry {
  return {
    id, turnId: id, kind: 'message', role: 'assistant', status: 'completed', authorUserId: null,
    sourceCommandId: null, origin, replayVerified, createdAt: '2026-08-15T00:00:00Z', completedAt: null,
    text: id, reasoning: [], toolCalls: [], resources: [], error: null,
  };
}

function resetStore() {
  setChatEntries([]);
  setChatHead(null);
  setPermissions([]);
  setElicitations([]);
  setRuntimeDocsState({ chat: false, control: false });
  vi.unstubAllGlobals();
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(resetStore);

describe('MessageList hydration', () => {
  it('describes recovery until both authoritative runtime documents arrive', () => {
    setRuntimeDocsState({ chat: true, control: false });
    render(() => <MessageList />);
    expect(screen.getByText('Loading session')).toBeInTheDocument();
    expect(screen.queryByText('Start this conversation')).not.toBeInTheDocument();
  });

  it('turns a confirmed empty projection into a meaningful first-message state', () => {
    setRuntimeDocsState({ chat: true, control: true });
    render(() => <MessageList />);
    expect(screen.getByText('Start this conversation')).toBeInTheDocument();
    expect(screen.getByText(/Content is saved to this session/)).toBeInTheDocument();
    expect(screen.queryByText('Loading session')).not.toBeInTheDocument();
  });

  it('renders one chat-level loading indicator from the control projection', () => {
    setRuntimeDocsState({ chat: true, control: true });
    setChatEntries([message('assistant-1', 'live', null)]);
    setChatHead({
      chat: { chatId: 'chat-1', title: null, status: 'active', activeTurnId: 'turn-1', loading: true, createdAt: null, updatedAt: null },
      agent: null,
      activeTurn: { turnId: 'turn-1', turnStatus: 'running', updatedAt: null },
      pendingPermissions: [],
    });

    render(() => <MessageList />);

    expect(screen.getByRole('status', { name: 'Assistant is working' })).toBeInTheDocument();
    expect(document.querySelectorAll('.message-loading')).toHaveLength(1);
  });

  it('exposes every simultaneous permission request in one navigable queue', () => {
    setRuntimeDocsState({ chat: true, control: true });
    setPermissions([
      { permissionId: 'p1', turnId: 't1', toolCallId: 'tool-1', title: 'Read file', description: null, status: 'pending', expiresAt: null, decision: null },
      { permissionId: 'p2', turnId: 't1', toolCallId: 'tool-2', title: 'Run command', description: null, status: 'pending', expiresAt: null, decision: null },
    ]);
    render(() => <MessageList />);

    expect(screen.getByLabelText('Pending permission requests, 2 total')).toBeInTheDocument();
    expect(screen.getByText('Read file')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Run command')).toBeInTheDocument();
  });

  it('shows one provenance chapter boundary and one live-runtime transition', () => {
    setRuntimeDocsState({ chat: true, control: true });
    setChatEntries([
      message('history-1', 'session_replay', true),
      message('history-2', 'session_replay', true),
      message('live-1', 'live', null),
    ]);
    render(() => <MessageList />);
    expect(screen.getAllByRole('separator')).toHaveLength(2);
    expect(screen.getByRole('separator', { name: 'Peri-verified recovered history' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Current run' })).toBeInTheDocument();
  });
});
