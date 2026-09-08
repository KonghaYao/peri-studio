import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { setChatEntries, setChatHead, setElicitations, setPermissions, setRuntimeDocsState, setSelectedCid } from '../../panel/store';
import { MessageList } from './MessageList';
import type { ChatEntry } from '@/entities/chat/chat-view';
import { blockUnknownMessageDelivery, messageSubmission, resetMessageDelivery, startMessageDelivery } from '../../panel/lib/message-delivery';

function message(id: string, origin: ChatEntry['origin'], replayVerified: boolean | null): ChatEntry {
  return {
    id, turnId: id, kind: 'message', role: 'assistant', status: 'completed', authorUserId: null,
    sourceCommandId: null, origin, replayVerified, createdAt: '2026-08-15T00:00:00Z', completedAt: null,
    text: id, blocks: [], reasoning: [], toolCalls: [], resources: [], error: null,
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

  it('returns to the latest message when the user sends, even after scrolling up', async () => {
    setRuntimeDocsState({ chat: true, control: true });
    setSelectedCid('chat-1');
    setChatEntries([message('assistant-1', 'live', null)]);
    render(() => <MessageList />);
    const area = screen.getByRole('region', { name: 'Conversation messages' });
    configureScrollArea(area);
    fireEvent.scroll(area);
    const scrollTo = vi.mocked(area.scrollTo);
    scrollTo.mockClear();

    startMessageDelivery('cmd-send', 'hello from composer', 'session-1', 'chat-1');
    await Promise.resolve();

    expect(scrollTo).toHaveBeenCalledWith({ top: 500, behavior: 'auto' });
    expect(screen.queryByRole('button', { name: /New content|latest/i })).not.toBeInTheDocument();
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

describe('MessageList footer resize', () => {
  it('keeps a compact reading margin at the end of the in-flow timeline', () => {
    setRuntimeDocsState({ chat: true, control: true });
    setChatEntries([message('assistant-1', 'live', null)]);
    const { container } = render(() => <MessageList footerHeight={160} />);

    expect(container.querySelector('[data-testid="message-list-content"]')).toHaveClass('chat-column', 'pb-32');
    expect(screen.getByRole('region', { name: 'Conversation messages' })).toHaveClass('message-list-scroll');
  });

  it('keeps following the true bottom when the in-flow footer grows', async () => {
    setRuntimeDocsState({ chat: true, control: true });
    setChatEntries([message('assistant-1', 'live', null)]);
    const [footerHeight, setFooterHeight] = createSignal(120);
    render(() => <MessageList footerHeight={footerHeight()} />);
    const area = screen.getByRole('region', { name: 'Conversation messages' });
    Object.defineProperties(area, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1_400 },
      scrollTop: { configurable: true, writable: true, value: 800 },
    });
    const scrollTo = vi.mocked(area.scrollTo);
    scrollTo.mockClear();

    setFooterHeight(260);
    await Promise.resolve();

    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1_400, behavior: 'auto' });
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
    const tool = messageRow.querySelector<HTMLButtonElement>('[data-testid="tool-activity-row-expand"]')!;
    fireEvent.click(reasoning.querySelector('summary')!);
    fireEvent.click(tool);
    expect(reasoning).toHaveAttribute('open');
    expect(tool).toHaveAttribute('aria-expanded', 'true');

    setChatEntries([{
      ...initial,
      text: 'Updated answer',
      reasoning: [{ ...initial.reasoning[0], text: 'Updated reasoning' }],
      toolCalls: [{ ...initial.toolCalls[0], result: { exitCode: 1 } }],
    }]);

    const updatedMessageRow = screen.getByLabelText('Assistant message');
    const updatedReasoning = screen.getByText('Thinking').closest('details')!;
    const updatedTool = updatedMessageRow.querySelector<HTMLButtonElement>('[data-testid="tool-activity-row-expand"]')!;
    expect(updatedMessageRow).toBe(messageRow);
    expect(updatedReasoning).toBe(reasoning);
    expect(updatedReasoning).toHaveAttribute('open');
    fireEvent.click(updatedTool);
    expect(updatedTool).toHaveAttribute('aria-expanded', 'true');
    expect(updatedMessageRow).toHaveTextContent('Updated answer');
    expect(updatedMessageRow).toHaveTextContent('Updated reasoning');
    expect(updatedMessageRow).toHaveTextContent('"exitCode": 1');
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

  it('keeps an empty transcript quiet once runtime documents are ready', () => {
    setRuntimeDocsState({ chat: true, control: true });
    render(() => <MessageList />);
    expect(screen.queryByTestId('chat-empty-workspace')).not.toBeInTheDocument();
    expect(screen.queryByText('Start this conversation')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading session')).not.toBeInTheDocument();
    expect(document.querySelector('.transcript-window [role="listitem"]')).toBeNull();
  });

  it('keeps one generic working state through the gap after completed tool output', () => {
    setRuntimeDocsState({ chat: true, control: true });
    setChatEntries([message('assistant-1', 'live', null)]);
    setChatHead({
      chat: { chatId: 'chat-1', title: null, status: 'active', activeTurnId: 'turn-1', loading: true, createdAt: null, updatedAt: null },
      agent: null,
      activeTurn: { turnId: 'turn-1', turnStatus: 'running', updatedAt: null },
      pendingPermissions: [],
    });

    render(() => <MessageList />);

    const loading = document.querySelector('[data-testid="message-loading"]')!;
    expect(loading).toHaveClass('message-loading');
    expect(loading).not.toHaveClass('sr-only');
    expect(loading).toHaveTextContent('Peri is working');
    expect(document.querySelectorAll('[data-testid="message-loading"]')).toHaveLength(1);

    setChatEntries([{
      ...message('turn-1', 'live', null),
      text: '',
      blocks: [{ kind: 'tool_call', id: 'tool-block', toolCall: {
        toolCallId: 'tool-1', name: 'Bash', kind: 'execute', status: 'completed', arguments: { command: 'pwd' }, result: { stdout: '/repo' },
        resultOmitted: false, resultBytes: 5, publicError: null, startedAt: null, completedAt: null,
      }}],
      toolCalls: [{ toolCallId: 'tool-1', name: 'Bash', kind: 'execute', status: 'completed', arguments: { command: 'pwd' }, result: { stdout: '/repo' }, resultOmitted: false, resultBytes: 5, publicError: null, startedAt: null, completedAt: null }],
    }]);
    expect(document.querySelector('[data-testid="message-loading"]')).toHaveTextContent('Peri is working');
    expect(screen.getByRole('status', { name: 'Agent activity' })).toHaveTextContent('Peri is working');

    setChatEntries([{
      ...message('turn-1', 'live', null),
      text: 'Next answer delta',
      blocks: [{ kind: 'text', id: 'text-block', text: 'Next answer delta' }],
      toolCalls: [{
        toolCallId: 'tool-1', name: 'Bash', kind: 'execute', status: 'completed', arguments: { command: 'pwd' }, result: { stdout: '/repo' },
        resultOmitted: false, resultBytes: 5, publicError: null, startedAt: null, completedAt: null,
      }],
    }]);
    expect(document.querySelector('[data-testid="message-loading"]')).toBeNull();
  });

  it('uses one aggregate live status without duplicating a running tool or permission surface', () => {
    setRuntimeDocsState({ chat: true, control: true });
    setChatHead({
      chat: { chatId: 'chat-1', title: null, status: 'active', activeTurnId: 'turn-1', loading: true, createdAt: null, updatedAt: null },
      agent: null,
      activeTurn: { turnId: 'turn-1', turnStatus: 'running', updatedAt: null },
      pendingPermissions: [],
    });
    setChatEntries([{
      ...message('turn-1', 'live', null),
      toolCalls: [{
        toolCallId: 'tool-1', name: 'Bash', kind: 'execute', status: 'running', arguments: { command: 'pwd' }, result: null,
        resultOmitted: false, resultBytes: null, publicError: null, startedAt: null, completedAt: null,
      }],
    }]);
    const view = render(() => <MessageList />);

    expect(document.querySelector('[data-testid="message-loading"]')).toBeNull();
    expect(screen.getByRole('status', { name: 'Agent activity' })).toHaveTextContent('Bash running');

    setPermissions([{ queueKey: 'p1', permissionId: 'p1', turnId: 'turn-1', toolCallId: null, title: 'Run command', description: null, options: ['allowOnce', 'deny'], status: 'pending', decision: null }]);
    setChatEntries([]);
    expect(document.querySelector('[data-testid="message-loading"]')).toBeNull();
    expect(screen.getByRole('status', { name: 'Agent activity' })).toHaveTextContent('Waiting for permission');

    setPermissions([]);
    setElicitations([{ elicitationId: 'e1', message: 'Choose a path', status: 'pending', responseAction: null, fields: [], createdAt: null }]);
    expect(document.querySelector('[data-testid="message-loading"]')).toBeNull();
    expect(screen.getByRole('status', { name: 'Agent activity' })).toHaveTextContent('Waiting for your answer');
    view.unmount();
  });

  it('reduces every assistant segment in the active turn using the latest authoritative activity', () => {
    setRuntimeDocsState({ chat: true, control: true });
    setChatHead({
      chat: { chatId: 'chat-1', title: null, status: 'active', activeTurnId: 'turn-1', loading: true, createdAt: null, updatedAt: null },
      agent: null,
      activeTurn: { turnId: 'turn-1', turnStatus: 'running', updatedAt: null },
      pendingPermissions: [],
    });
    const runningTool = {
      toolCallId: 'tool-segment', name: 'Bash', kind: 'execute' as const, status: 'running', arguments: { command: 'test' }, result: null,
      resultOmitted: false, resultBytes: null, publicError: null, startedAt: null, completedAt: null,
    };
    const firstText = { ...message('segment-text', 'live', null), turnId: 'turn-1', text: 'First delta', blocks: [{ kind: 'text' as const, id: 'text-1', text: 'First delta' }] };
    const toolSegment = { ...message('segment-tool', 'live', null), turnId: 'turn-1', text: '', status: 'streaming', blocks: [{ kind: 'tool_call' as const, id: 'tool-1', toolCall: runningTool }], toolCalls: [runningTool] };
    render(() => <MessageList />);

    setChatEntries([firstText, toolSegment]);
    expect(document.querySelector('[data-testid="message-loading"]')).toBeNull();
    expect(screen.getByRole('status', { name: 'Agent activity' })).toHaveTextContent('Bash running');

    const completedTool = { ...runningTool, status: 'completed', result: { exitCode: 0 }, completedAt: '2026-08-15T00:00:01Z' };
    setChatEntries([firstText, { ...toolSegment, toolCalls: [completedTool], blocks: [{ kind: 'tool_call', id: 'tool-1', toolCall: completedTool }] }]);
    expect(document.querySelector('[data-testid="message-loading"]')).toHaveTextContent('Peri is working');

    const finalText = { ...message('segment-final', 'live', null), turnId: 'turn-1', text: 'Final delta', blocks: [{ kind: 'text' as const, id: 'text-2', text: 'Final delta' }] };
    setChatEntries([firstText, { ...toolSegment, toolCalls: [completedTool], blocks: [{ kind: 'tool_call', id: 'tool-1', toolCall: completedTool }] }, finalText]);
    expect(document.querySelector('[data-testid="message-loading"]')).toBeNull();
    expect(screen.getByRole('status', { name: 'Agent activity' })).toHaveTextContent('');
  });

  it('does not add generic loading while any earlier tool in the active turn remains nonterminal', () => {
    setRuntimeDocsState({ chat: true, control: true });
    setChatHead({
      chat: { chatId: 'chat-1', title: null, status: 'active', activeTurnId: 'turn-1', loading: true, createdAt: null, updatedAt: null },
      agent: null,
      activeTurn: { turnId: 'turn-1', turnStatus: 'running', updatedAt: null },
      pendingPermissions: [],
    });
    const running = { toolCallId: 'parallel-running', name: 'Bash', kind: 'execute' as const, status: 'running', arguments: {}, result: null, resultOmitted: false, resultBytes: null, publicError: null, startedAt: null, completedAt: null };
    const completed = { ...running, toolCallId: 'parallel-completed', name: 'Read', kind: 'read' as const, status: 'completed', result: {}, completedAt: '2026-08-15T00:00:01Z' };
    setChatEntries([
      { ...message('segment-running', 'live', null), turnId: 'turn-1', text: '', status: 'streaming', blocks: [{ kind: 'tool_call', id: 'running', toolCall: running }], toolCalls: [running] },
      { ...message('segment-completed', 'live', null), turnId: 'turn-1', text: '', status: 'streaming', blocks: [{ kind: 'tool_call', id: 'completed', toolCall: completed }], toolCalls: [completed] },
    ]);

    render(() => <MessageList />);
    expect(document.querySelector('[data-testid="message-loading"]')).toBeNull();
    expect(screen.getByRole('status', { name: 'Agent activity' })).toHaveTextContent('Bash running');
  });

  it('keeps pending permissions out of the transcript surface', () => {
    setRuntimeDocsState({ chat: true, control: true });
    setPermissions([
      { queueKey: 'p1', permissionId: 'p1', turnId: 't1', toolCallId: 'tool-1', title: 'Read file', description: null, options: ['allowOnce', 'deny'], status: 'pending', decision: null },
      { queueKey: 'p2', permissionId: 'p2', turnId: 't1', toolCallId: 'tool-2', title: 'Run command', description: null, options: ['allowOnce', 'deny'], status: 'pending', decision: null },
    ]);
    render(() => <MessageList />);

    expect(screen.queryByLabelText('Pending permission requests, 2 total')).not.toBeInTheDocument();
    expect(screen.queryByText('Read file')).not.toBeInTheDocument();
    expect(screen.queryByText('Run command')).not.toBeInTheDocument();
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
    expect(screen.getByRole('separator', { name: 'Peri-verified recovered history' })).toHaveTextContent('Verified history');
    expect(screen.getByRole('separator', { name: 'Current run' })).toBeInTheDocument();
  });

  it('keeps inferred replay provenance out of the visible transcript', () => {
    setRuntimeDocsState({ chat: true, control: true });
    setChatEntries([message('history-1', 'session_replay', false)]);
    render(() => <MessageList />);
    expect(screen.queryByText('Unverified history')).not.toBeInTheDocument();
    expect(screen.queryByRole('separator', { name: 'Unverified recovered history' })).not.toBeInTheDocument();
  });
});
