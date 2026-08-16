import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setChatEntries, setElicitations, setPermissions, setRuntimeDocsState } from '../store';
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
  setPermissions([]);
  setElicitations([]);
  setRuntimeDocsState({ chat: false, control: false });
  vi.unstubAllGlobals();
}

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

  it('reveals a newly projected Peri question instead of leaving it above the scroll position', async () => {
    setRuntimeDocsState({ chat: true, control: true });
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    render(() => <MessageList />);
    setElicitations([{
      elicitationId: 'question-1',
      message: 'How should Peri continue?',
      status: 'pending',
      responseAction: null,
      createdAt: '2026-08-15T00:00:00Z',
      fields: [{ id: 'detail', title: 'Detail', description: null, kind: 'text', required: true, options: [] }],
    }]);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' }));
    expect(screen.getByRole('form', { name: 'How should Peri continue?' })).toBeInTheDocument();
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
