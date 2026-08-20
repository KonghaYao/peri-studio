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

describe('MessageList timeline follow', () => {
  function configureScrollArea(area: HTMLElement) {
    Object.defineProperties(area, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
  }

  it('preserves an up-scrolled reader position and offers an explicit new-content action', () => {
    setRuntimeDocsState({ chat: true, control: true });
    setChatEntries([message('assistant-1', 'live', null)]);
    render(() => <MessageList />);
    const area = screen.getByRole('region', { name: 'Conversation messages' });
    configureScrollArea(area);
    const scrollTo = vi.mocked(area.scrollTo);
    scrollTo.mockClear();

    fireEvent.scroll(area);
    setChatEntries([message('assistant-1', 'live', null), message('assistant-2', 'live', null)]);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '↓ New content' })).toBeInTheDocument();
  });

  it('returns to the latest message without motion when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    setRuntimeDocsState({ chat: true, control: true });
    setChatEntries([message('assistant-1', 'live', null)]);
    render(() => <MessageList />);
    const area = screen.getByRole('region', { name: 'Conversation messages' });
    configureScrollArea(area);
    const scrollTo = vi.mocked(area.scrollTo);
    scrollTo.mockClear();

    fireEvent.scroll(area);
    setChatEntries([message('assistant-1', 'live', null), message('assistant-2', 'live', null)]);
    fireEvent.click(screen.getByRole('button', { name: '↓ New content' }));

    expect(scrollTo).toHaveBeenLastCalledWith({ top: 500, behavior: 'auto' });
    expect(screen.queryByRole('button', { name: /latest/i })).not.toBeInTheDocument();
  });
});

describe('MessageList overlay inset', () => {
  it('keeps the last message and jump action above an overlay composer', () => {
    setRuntimeDocsState({ chat: true, control: true });
    setChatEntries([message('assistant-1', 'live', null)]);
    const { container } = render(() => <MessageList bottomInset={160} />);

    expect(container.querySelector('.message-list-content')).toHaveStyle({ 'padding-bottom': '200px' });
  });
});

describe('MessageList completion announcement', () => {
  it('does not re-announce recovered history that arrives after hydration, then announces one newly completed response', () => {
    setRuntimeDocsState({ chat: true, control: false });
    render(() => <MessageList />);
    const announcement = document.querySelector('[aria-atomic="true"]');

    setChatEntries([message('history-1', 'session_replay', true)]);
    setRuntimeDocsState({ chat: true, control: true });

    expect(announcement).toHaveTextContent('');
    setChatEntries([{ ...message('assistant-1', 'live', null), status: 'completed' }]);

    expect(announcement).toHaveTextContent('Assistant response completed');
    expect(announcement).toHaveAttribute('aria-live', 'polite');
    expect(announcement).toHaveAttribute('aria-atomic', 'true');
  });
});

describe('MessageList entry updates', () => {
  it('keeps the same message, reasoning, and tool DOM nodes open while its server projection updates', () => {
    setRuntimeDocsState({ chat: true, control: true });
    const initial = {
      ...message('assistant-1', 'live', null),
      reasoning: [{ id: 'reasoning-1', text: 'Inspecting the current state', visibility: 'visible' }],
      toolCalls: [{
        toolCallId: 'tool-1', name: 'shell', status: 'completed', arguments: { command: 'pwd' }, result: { exitCode: 0 },
        resultOmitted: false, resultBytes: 14, publicError: null, startedAt: null, completedAt: null,
      }],
    };
    setChatEntries([initial]);
    render(() => <MessageList />);

    const messageRow = screen.getByLabelText('Assistant message');
    const reasoning = screen.getByText('Thinking').closest('details')!;
    const tool = messageRow.querySelector<HTMLDetailsElement>('.tool-card')!;
    fireEvent.click(reasoning.querySelector('summary')!);
    fireEvent.click(tool.querySelector('summary')!);
    expect(reasoning).toHaveAttribute('open');
    expect(tool).toHaveAttribute('open');

    setChatEntries([{
      ...initial,
      text: 'Updated answer',
      reasoning: [{ ...initial.reasoning[0], text: 'Updated reasoning' }],
      toolCalls: [{ ...initial.toolCalls[0], result: { exitCode: 1 } }],
    }]);

    const updatedMessageRow = screen.getByLabelText('Assistant message');
    const updatedReasoning = screen.getByText('Thinking').closest('details')!;
    const updatedTool = updatedMessageRow.querySelector<HTMLDetailsElement>('.tool-card')!;
    expect(updatedMessageRow).toBe(messageRow);
    expect(updatedReasoning).toBe(reasoning);
    expect(updatedTool).toBe(tool);
    expect(updatedReasoning).toHaveAttribute('open');
    expect(updatedTool).toHaveAttribute('open');
    expect(updatedMessageRow).toHaveTextContent('Updated answer');
    expect(updatedMessageRow).toHaveTextContent('Updated reasoning');
    expect(updatedTool).toHaveTextContent('"exitCode": 1');
  });
});

describe('MessageList hydration', () => {
  it('describes recovery until both authoritative runtime documents arrive', () => {
    setRuntimeDocsState({ chat: true, control: false });
    render(() => <MessageList />);
    const loading = screen.getByRole('status', { name: 'Loading session' });
    expect(loading).toHaveAttribute('aria-live', 'polite');
    expect(loading).toHaveTextContent('Restoring messages and runtime state from the Peri Studio server…');
    expect(loading.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.queryByText('Start this conversation')).not.toBeInTheDocument();
  });

  it('turns a confirmed empty projection into a meaningful first-message state', () => {
    setRuntimeDocsState({ chat: true, control: true });
    render(() => <MessageList />);
    const empty = screen.getByRole('heading', { name: 'Start this conversation' }).parentElement;
    expect(empty).toBeInTheDocument();
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

    const loading = screen.getByRole('status', { name: 'Assistant is working' });
    expect(loading).toHaveClass('message-loading');
    expect(loading).toHaveAttribute('aria-live', 'polite');
    expect(loading).toHaveTextContent('Working…');
    expect(loading.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
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
