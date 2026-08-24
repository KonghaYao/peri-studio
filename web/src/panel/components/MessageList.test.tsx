import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setChatEntries, setChatHead, setElicitations, setPermissions, setRuntimeDocsState, setSelectedCid } from '../store';
import { MessageList } from './MessageList';
import type { ChatEntry } from '../lib/chat-view';
import { blockUnknownMessageDelivery, messageSubmission, resetMessageDelivery, startMessageDelivery } from '../lib/message-delivery';

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
  setSelectedCid(null);
  resetMessageDelivery();
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

  it('resets an up-scrolled reader to the latest content when the selected chat changes', async () => {
    setRuntimeDocsState({ chat: true, control: true });
    setSelectedCid('chat-1');
    setChatEntries([message('chat-1-entry', 'live', null)]);
    render(() => <MessageList />);
    const area = screen.getByRole('region', { name: 'Conversation messages' });
    configureScrollArea(area);
    fireEvent.scroll(area);
    const scrollTo = vi.mocked(area.scrollTo);
    scrollTo.mockClear();

    setSelectedCid('chat-2');
    setChatEntries([message('chat-2-entry', 'live', null)]);
    await Promise.resolve();

    expect(scrollTo).toHaveBeenLastCalledWith({ top: 500, behavior: 'auto' });
    expect(screen.queryByRole('button', { name: /New content|latest/i })).not.toBeInTheDocument();
    expect(screen.getByText('chat-2-entry')).toBeInTheDocument();
  });

  it('preserves the visible transcript when the permission prefix changes height', () => {
    const observed: Array<{ target: Element; callback: ResizeObserverCallback }> = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) { observed.push({ target, callback: this.callback }); }
      disconnect() {}
      unobserve() {}
    });
    setRuntimeDocsState({ chat: true, control: true });
    setChatEntries([message('assistant-1', 'live', null)]);
    render(() => <MessageList />);
    const area = screen.getByRole('region', { name: 'Conversation messages' });
    configureScrollArea(area);
    area.scrollTop = 100;
    fireEvent.scroll(area);
    const prefix = observed.find(({ target }) => target.classList.contains('transcript-prefix'))!;

    prefix.callback([{ contentRect: { height: 40 } } as ResizeObserverEntry], {} as ResizeObserver);
    prefix.callback([{ contentRect: { height: 100 } } as ResizeObserverEntry], {} as ResizeObserver);

    expect(area.scrollTop).toBe(160);
  });

  it('mounts only a bounded accessible tail window for two thousand messages', () => {
    setRuntimeDocsState({ chat: true, control: true });
    setChatEntries(Array.from({ length: 2_000 }, (_, index) => ({
      ...message(`entry-${index}`, 'live', null), role: 'user', text: `transcript-${index}`,
    })));
    render(() => <MessageList />);
    const area = screen.getByRole('region', { name: 'Conversation messages' });
    Object.defineProperties(area, {
      clientHeight: { configurable: true, value: 800 },
      scrollHeight: { configurable: true, value: 160_000 },
      scrollTop: { configurable: true, writable: true, value: 159_200 },
    });

    fireEvent.scroll(area);

    const rows = screen.getAllByRole('listitem');
    expect(rows.length).toBeLessThanOrEqual(24);
    expect(rows.at(-1)).toHaveAttribute('aria-posinset', '2000');
    expect(rows.at(-1)).toHaveAttribute('aria-setsize', '2000');
    expect(screen.getByText('transcript-1999')).toBeInTheDocument();
    expect(screen.queryByText('transcript-0')).not.toBeInTheDocument();
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
  it('keeps acknowledged delivery-unknown evidence visible after freeing the composer', () => {
    setRuntimeDocsState({ chat: true, control: true });
    setSelectedCid('chat-1');
    startMessageDelivery('unknown', 'possibly executed', 'session-1', 'chat-1');
    blockUnknownMessageDelivery('unknown');
    render(() => <MessageList />);

    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge and continue' }));
    expect(messageSubmission()).toBeNull();
    expect(screen.getByRole('group', { name: 'Your unresolved message' })).toHaveTextContent('possibly executed');
    expect(screen.getByText('Unconfirmed delivery retained')).toBeInTheDocument();
  });

  it('describes recovery until both authoritative runtime documents arrive', () => {
    setRuntimeDocsState({ chat: true, control: false });
    render(() => <MessageList />);
    const loading = screen.getByRole('status', { name: 'Loading session' });
    expect(loading).toHaveAttribute('aria-live', 'polite');
    expect(loading).toHaveTextContent('Loading session');
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

    const loading = document.querySelector('.message-loading')!;
    expect(loading).toHaveClass('message-loading');
    expect(loading).toHaveClass('sr-only');
    expect(loading).toHaveAttribute('aria-live', 'polite');
    expect(loading).toHaveTextContent('Agent working');
    expect(document.querySelectorAll('.message-loading')).toHaveLength(1);
  });

  it('exposes every simultaneous permission request in one navigable queue', () => {
    setRuntimeDocsState({ chat: true, control: true });
    setPermissions([
      { permissionId: 'p1', turnId: 't1', toolCallId: 'tool-1', title: 'Read file', description: null, options: ['allowOnce', 'deny'], status: 'pending', expiresAt: null, decision: null },
      { permissionId: 'p2', turnId: 't1', toolCallId: 'tool-2', title: 'Run command', description: null, options: ['allowOnce', 'deny'], status: 'pending', expiresAt: null, decision: null },
    ]);
    render(() => <MessageList />);

    expect(screen.getByLabelText('Pending permission requests, 2 total')).toBeInTheDocument();
    expect(screen.getByText('Read file')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next permission' }));
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
