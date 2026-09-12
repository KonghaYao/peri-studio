import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatEntry } from '@/entities/chat/chat-view';
import { ConversationMessage } from './ConversationMessage';
import { Markdown } from './Markdown';
import { composerQuoteRequest, resetComposerQuoteRequest } from '@/features/composer/composer-quote';
import { setPrincipalRole } from '@/features/auth/auth-state';
import {
  setChatCatalog,
  setSelectedCid,
} from '@/store';
import {
  handleMcpAppResource,
  handleMcpAppSession,
  installMcpApps,
  openMcpApp,
  resetMcpAppsState,
} from '@/features/mcp/mcp-apps';

vi.mock('@/features/mcp/mcp-app-host', () => ({
  bindMcpAppHost: vi.fn(async () => ({ close: vi.fn(async () => undefined) })),
}));

function entry(overrides: Partial<ChatEntry> = {}): ChatEntry {
  return {
    id: 'entry-1', turnId: 'turn-1', kind: 'message', role: 'assistant', status: 'completed', authorUserId: null, sourceCommandId: null,
    origin: 'live', replayVerified: null, createdAt: '2026-08-13T12:00:00Z', completedAt: '2026-08-13T12:00:01Z', text: '', blocks: [], reasoning: [], toolCalls: [], resources: [], error: null,
    ...overrides,
  };
}

function baseTool(toolCallId: string) {
  return {
    toolCallId, name: 'shell', status: 'completed', arguments: {}, result: null,
    resultOmitted: false, resultBytes: 0, publicError: null, startedAt: null, completedAt: null,
  };
}

describe('ConversationMessage', () => {
  afterEach(() => {
    resetMcpAppsState();
    setPrincipalRole(null);
    setSelectedCid(null);
    setChatCatalog([]);
  });
  it('keeps user text plain and visually separate from assistant Markdown', () => {
    const view = render(() => <ConversationMessage entry={entry({ role: 'user', text: '**literal user input**' })} />);
    const message = screen.getByLabelText('Your message');
    expect(message).toHaveClass('conversation-message--user');
    expect(message).toHaveTextContent('**literal user input**');
    expect(message.querySelector('strong')).toBeNull();
    expect(message.querySelector('[data-testid="conversation-message-meta"]')).toHaveClass('flex');
    expect(message.querySelector('.flex.w-full.justify-end')).not.toBeNull();
    expect(message.querySelector('[class*="max-w-(--chat-bubble-max)"]')).toHaveClass('rounded-xl', 'bg-surface-overlay', 'text-content-primary', 'min-w-0');
    expect(screen.queryByRole('button', { name: 'Copy answer' })).not.toBeInTheDocument();
    view.unmount();
  });

  it('renders completed assistant content as a coding reader', () => {
    render(() => <ConversationMessage entry={entry({ text: '## Result\n\n`cargo test` passed.' })} />);

    expect(screen.getByLabelText('Assistant message')).toHaveClass('conversation-message--assistant');
    expect(screen.getByRole('heading', { name: 'Result' })).toBeInTheDocument();
    expect(screen.getByText('cargo test')).toHaveAttribute('data-testid', 'md-inline-code');
    expect(screen.queryByRole('button', { name: 'Copy answer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quote answer' })).not.toBeInTheDocument();
  });

  it('offers an add-to-conversation action for selected message text', () => {
    resetComposerQuoteRequest();
    render(() => <ConversationMessage entry={entry({ text: 'Select only this sentence.' })} />);
    const message = screen.getByLabelText('Assistant message');
    const selectedNode = screen.getByText('Select only this sentence.').firstChild!;
    const removeAllRanges = vi.fn();
    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'only this sentence',
      getRangeAt: () => ({
        commonAncestorContainer: selectedNode,
        getBoundingClientRect: () => ({ left: 100, top: 80, width: 120, height: 18 }),
      }),
      removeAllRanges,
    } as unknown as Selection);

    fireEvent.mouseUp(message);
    fireEvent.click(screen.getByRole('button', { name: 'Add selection to conversation' }));

    expect(composerQuoteRequest()).toMatchObject({ text: 'only this sentence', source: 'Peri' });
    expect(removeAllRanges).toHaveBeenCalled();
    getSelection.mockRestore();
  });

  it('marks interrupted output as partial in the reader', () => {
    render(() => <ConversationMessage entry={entry({ status: 'interrupted', text: 'Incomplete result' })} />);

    const partial = screen.getByRole('status');
    expect(partial).toHaveTextContent('Response interrupted. The output above may be incomplete.');
    expect(screen.queryByRole('button', { name: 'Copy answer' })).not.toBeInTheDocument();
  });

  it.each(['cancelled', 'failed', 'error'])('labels %s partial output with its terminal state', (status) => {
    render(() => <ConversationMessage entry={entry({ status, text: 'Partial output' })} />);
    const failedLabel = status === 'failed' || status === 'error';
    expect(screen.getByLabelText('Assistant message')).toHaveTextContent(
      `Response ${status === 'cancelled' ? 'cancelled' : failedLabel ? 'failed' : status}. The output above may be incomplete.`,
    );
  });

  it('keeps incomplete streaming syntax readable until completion', () => {
    const view = render(() => <ConversationMessage entry={entry({ status: 'streaming', text: '**partial' })} />);
    const message = screen.getByLabelText('Assistant message');
    expect(message).toHaveTextContent('partial');
    expect(message.querySelector('.markdown-body')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy answer' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="message-loading"]')).toBeNull();
    view.unmount();
  });

  it('renders complete Markdown constructs before the assistant turn finishes', () => {
    render(() => <ConversationMessage entry={entry({
      status: 'streaming',
      text: '## Changes\n\n**Done** with `cargo test`.',
    })} />);

    expect(screen.getByRole('heading', { name: 'Changes' })).toBeInTheDocument();
    expect(screen.getByText('Done')).toHaveProperty('tagName', 'STRONG');
    expect(screen.getByText('cargo test')).toHaveAttribute('data-testid', 'md-inline-code');
  });

  it('keeps the streaming Markdown surface mounted while text grows', () => {
    const [current, setCurrent] = createSignal(entry({ status: 'streaming', text: 'First' }));
    render(() => <ConversationMessage entry={current} />);
    const surface = document.querySelector('[data-testid="markdown-body"]');
    setCurrent(entry({ status: 'streaming', text: 'First second' }));
    expect(document.querySelector('[data-testid="markdown-body"]')).toBe(surface);
    expect(surface).toHaveTextContent('First second');
  });

  it('preserves completed Markdown block instances while the stream edge grows', async () => {
    const [source, setSource] = createSignal('```ts\nconst value = 1;\n```\n\nFirst');
    render(() => <Markdown source={source} streaming />);
    await waitFor(() => expect(document.querySelector('[data-testid="md-code-block"]')).toHaveAttribute('data-highlighted', 'true'));
    const codeBlock = document.querySelector('[data-testid="md-code-block"]');
    setSource('```ts\nconst value = 1;\n```\n\nFirst second');
    expect(document.querySelector('[data-testid="md-code-block"]')).toBe(codeBlock);
  });

  it('preserves remote image consent while later Markdown streams in', () => {
    const [source, setSource] = createSignal('![Diagram](https://example.test/diagram.png)\n\nFirst');
    render(() => <Markdown source={source} streaming />);
    fireEvent.click(screen.getByRole('button', { name: 'Load image: Diagram' }));
    const image = screen.getByRole('img', { name: 'Diagram' });
    setSource('![Diagram](https://example.test/diagram.png)\n\nFirst second');
    expect(screen.getByRole('img', { name: 'Diagram' })).toBe(image);
  });

  it('shows the remote hostname before image consent', () => {
    render(() => <Markdown source={'![Diagram](https://assets.example.test/diagram.png)'} />);
    expect(screen.getByText(/assets\.example\.test/)).toBeInTheDocument();
  });

  it('renders assistant blocks in the server-projected order', () => {
    const tool = {
      toolCallId: 'tool-1', name: 'shell', status: 'completed', arguments: {}, result: null,
      resultOmitted: false, resultBytes: 0, publicError: null, startedAt: null, completedAt: null,
    };
    render(() => <ConversationMessage entry={entry({
      text: 'Before toolAfter tool',
      toolCalls: [tool],
      blocks: [
        { kind: 'text', id: 'intro', text: 'Before tool' },
        { kind: 'tool_call', id: 'tool-block', toolCall: tool },
        { kind: 'text', id: 'outro', text: 'After tool' },
      ],
    })} />);

    const message = screen.getByLabelText('Assistant message');
    const before = screen.getByText('Before tool');
    const toolGroup = message.querySelector('[data-testid="chat-activity-chain"] [data-testid="tool-activity-group"]')!;
    const after = screen.getByText('After tool');
    expect(before.compareDocumentPosition(toolGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toolGroup.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('groups adjacent tool activity rows as compact rows without card borders', () => {
    const first = { ...baseTool('tool-1'), name: 'Read config' };
    const second = { ...baseTool('tool-2'), name: 'Run checks' };
    render(() => <ConversationMessage entry={entry({
      toolCalls: [first, second],
      blocks: [
        { kind: 'tool_call', id: 'tool-1', toolCall: first },
        { kind: 'tool_call', id: 'tool-2', toolCall: second },
      ],
    })} />);

    const group = screen.getByLabelText('Assistant message').querySelector('[data-testid="chat-activity-chain"] [data-testid="tool-activity-group"]')!;
    expect(group).toHaveClass('tool-activity-group--activity', 'tool-call-group-list');
    expect(group.closest('[data-testid="chat-activity-chain"]')).toBeTruthy();
    const rows = group.querySelectorAll('[data-testid="tool-activity-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveClass('tool-activity-row--activity');
    expect(rows[0].querySelector('.tool-call-row-icon')).toBeInTheDocument();
    expect(rows[0].querySelector('[data-testid="tool-activity-row-summary"]')).toHaveClass('chat-tool-call-row');
  });

  it('passes the selected chat cwd through the activity tool chain', () => {
    setSelectedCid('chat-1');
    setChatCatalog([{
      id: 'chat-1',
      instanceId: 'instance-1',
      title: 'Project chat',
      status: 'ready',
      gap: null,
      updatedAt: null,
      cwd: '/workspace/project',
      workspaceId: null,
    }]);
    const tool = {
      ...baseTool('tool-1'),
      name: 'Read',
      kind: 'read' as const,
      arguments: { file_path: '/workspace/project/web/src/main.ts' },
    };
    render(() => <ConversationMessage entry={entry({
      toolCalls: [tool],
      blocks: [{ kind: 'tool_call', id: 'tool-1', toolCall: tool }],
    })} />);

    expect(screen.getByTestId('tool-activity-file-link')).toHaveTextContent('main.ts');
  });

  it('shows skeleton thinking gap only while the turn is still streaming', () => {
    const tool = { ...baseTool('tool-1'), name: 'Bash', arguments: { command: 'pwd' } };
    render(() => <ConversationMessage entry={entry({
      status: 'streaming',
      completedAt: null,
      toolCalls: [tool],
      blocks: [
        { kind: 'reasoning', id: 'reasoning-empty', reasoning: { id: 'reasoning-empty', text: '   ', visibility: 'visible' } },
        { kind: 'tool_call', id: 'tool-1', toolCall: tool },
      ],
    })} />);

    const message = screen.getByLabelText('Assistant message');
    expect(message.querySelector('[data-testid="thinking-gap"]')).toHaveClass('thinking-gap', 'relative', 'z-1');
    expect(message.querySelector('.message-reasoning__activity-label')).toBeNull();
  });

  it('hides completed empty thinking placeholders in the activity chain', () => {
    const tool = { ...baseTool('tool-1'), name: 'Bash', arguments: { command: 'pwd' } };
    render(() => <ConversationMessage entry={entry({
      toolCalls: [tool],
      blocks: [
        { kind: 'reasoning', id: 'reasoning-empty', reasoning: { id: 'reasoning-empty', text: '', visibility: 'visible' } },
        { kind: 'tool_call', id: 'tool-1', toolCall: tool },
      ],
    })} />);

    expect(screen.queryByTestId('message-reasoning')).toBeNull();
    expect(screen.getByTestId('tool-activity-row')).toBeInTheDocument();
  });

  it('keeps activity reasoning collapsed by default and expands it on demand', () => {
    const tool = { ...baseTool('tool-1'), name: 'Bash', arguments: { command: 'pwd' } };
    render(() => <ConversationMessage entry={entry({
      toolCalls: [tool],
      blocks: [
        { kind: 'reasoning', id: 'reasoning-1', reasoning: { id: 'reasoning-1', text: 'Check imports first.', visibility: 'visible' } },
        { kind: 'tool_call', id: 'tool-1', toolCall: tool },
      ],
    })} />);

    const details = screen.getByText('Reasoning').closest('details')!;
    const summary = screen.getByText('Reasoning');
    const body = screen.getByText('Check imports first.');
    expect(summary).toHaveClass('tool-call-row-title', 'text-12', 'text-content-muted');
    expect(details).toHaveClass('tool-activity-row--activity');
    expect(details).not.toHaveAttribute('open');
    expect(body).not.toBeVisible();
    expect(body.closest('.tool-activity-row__body')).toHaveClass('relative', 'z-1', 'pl-16', 'font-normal');

    fireEvent.click(screen.getByText('Reasoning'));
    expect(details).toHaveAttribute('open');
    expect(body).toBeVisible();
  });

  it('does not show thinking gap when the activity chain has only tools', () => {
    const first = { ...baseTool('tool-1'), name: 'Read config' };
    const second = { ...baseTool('tool-2'), name: 'Run checks' };
    render(() => <ConversationMessage entry={entry({
      toolCalls: [first, second],
      blocks: [
        { kind: 'tool_call', id: 'tool-1', toolCall: first },
        { kind: 'tool_call', id: 'tool-2', toolCall: second },
      ],
    })} />);

    const message = screen.getByLabelText('Assistant message');
    expect(message.querySelector('[data-testid="thinking-gap"]')).toBeNull();
  });

  it('renders reasoning before grouped tool activity', () => {
    const tool = { ...baseTool('tool-1'), name: 'Bash', arguments: { command: 'pwd' } };
    render(() => <ConversationMessage entry={entry({
      reasoning: [{ id: 'reasoning-1', text: 'Inspect the repository', visibility: 'visible' }],
      toolCalls: [tool],
      blocks: [
        { kind: 'reasoning', id: 'reasoning-1', reasoning: { id: 'reasoning-1', text: 'Inspect the repository', visibility: 'visible' } },
        { kind: 'tool_call', id: 'tool-1', toolCall: tool },
      ],
    })} />);

    const message = screen.getByLabelText('Assistant message');
    const reasoning = message.querySelector('[data-testid="chat-activity-chain"] [data-testid="message-reasoning"]')!;
    const toolRow = message.querySelector('[data-testid="tool-activity-row-summary"]')!;
    expect(reasoning.className).toContain('message-reasoning');
    expect(reasoning.compareDocumentPosition(toolRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps untrusted HTML inert in assistant Markdown', () => {
    const view = render(() => <ConversationMessage entry={entry({ text: '<img src=x onerror="alert(1)"> safe' })} />);
    expect(screen.getByLabelText('Assistant message')).toHaveTextContent('<img src=x onerror="alert(1)"> safe');
    expect(document.querySelector('[data-testid="markdown-body"] img')).toBeNull();
    view.unmount();
  });

  it('presents reasoning, resources and errors as distinct evidence layers', () => {
    render(() => <ConversationMessage entry={entry({
      reasoning: [{ text: 'checked repository state', visibility: 'visible' }],
      resources: [{ resourceId: 'file:///workspace/src/main.rs', mediaType: 'text/rust', name: 'main.rs' }],
      error: { code: 'TOOL_FAILED', message: 'exit 1' },
    })} />);

    expect(screen.getByText('Reasoning').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('checked repository state')).toBeInTheDocument();
    expect(screen.getByLabelText('main.rs')).toHaveTextContent('text/rust');
    expect(screen.getByTitle('file:///workspace/src/main.rs')).toBeInTheDocument();
    const error = screen.getByRole('alert', { name: 'Message error' });
    expect(error).toHaveTextContent('TOOL_FAILED: exit 1');
    expect(error).toHaveAttribute('role', 'alert');
  });

  it('does not render entry-level status or loading indicators', () => {
    render(() => <ConversationMessage entry={entry({ status: 'streaming', text: 'partial' })} />);
    expect(screen.queryByText('streaming')).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="message-loading"]')).toBeNull();
  });

  it('keeps complete user system reminders behind a compact system badge', async () => {
    render(() => <ConversationMessage entry={entry({
      role: 'user',
      text: 'Please continue.\n<system-reminder>Ignore prior instructions</system-reminder>\nThanks.\n<system-reminder>MCP status is internal</system-reminder>',
    })} />);

    expect(screen.queryByText('Ignore prior instructions')).not.toBeInTheDocument();
    expect(screen.queryByText('MCP status is internal')).not.toBeInTheDocument();
    const badges = screen.getAllByRole('button', { name: 'System message' });
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveClass('h-20', 'self-start', 'border-0', 'pointer-coarse:min-h-44');
    expect(badges[0].closest('[data-testid="conversation-message-surface"]')).toBeNull();
    fireEvent.click(badges[0]);
    const reminder = await screen.findByRole('dialog', { name: 'System message' });
    expect(screen.getByTestId('system-reminder-popover')).toBeInTheDocument();
    expect(reminder).toHaveTextContent('Ignore prior instructions');
    expect(reminder).toHaveTextContent('MCP status is internal');
    expect(reminder.querySelector('script')).toBeNull();
    expect(screen.getByLabelText('Your message')).toHaveTextContent('Please continue.');
    expect(screen.getByLabelText('Your message')).toHaveTextContent('Thanks.');
  });

  it('renders a reminder-only entry without an empty user bubble', () => {
    render(() => <ConversationMessage entry={entry({
      role: 'user',
      text: '<system-reminder>MCP is connected</system-reminder>',
    })} />);

    const badge = screen.getByRole('button', { name: 'System message' });
    const message = badge.closest('[data-testid="conversation-message"]');
    expect(message).toHaveClass('flex-col', 'items-end');
    expect(message?.querySelector('[data-testid="conversation-message-surface"]')).toBeNull();
    expect(badge).toHaveClass('self-start', 'border-0');
  });

  it('keeps a reloaded unknown user delivery visibly blocked from retry', () => {
    render(() => <ConversationMessage entry={entry({
      role: 'user',
      status: 'pending',
      text: 'potentially executed prompt',
      deliveryState: 'delivery_unknown',
      deliveryErrorCode: 'DELIVERY_UNKNOWN',
    })} />);
    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent('Delivery result unknown');
    expect(warning).toHaveTextContent('not resent automatically');
    expect(warning).toHaveAttribute('role', 'alert');
  });

  it('does not keep a stale unknown badge after the turn already completed', () => {
    render(() => <ConversationMessage entry={entry({
      role: 'user',
      status: 'pending',
      text: 'already answered',
      deliveryState: 'completed',
    })} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Delivery result unknown')).not.toBeInTheDocument();
  });

  it('does not present Hub observation time as the original time of restored history', () => {
    render(() => <ConversationMessage entry={entry({
      origin: 'session_replay', replayVerified: true, text: 'older answer', createdAt: new Date().toISOString(),
    })} />);
    expect(screen.getByLabelText('Assistant message').querySelector('time')).toBeNull();
  });
});

describe('Markdown', () => {
  it('renders raw HTML and active links as inert text', () => {
    render(() => <Markdown source={'<script>alert(1)</script>\n\n[unsafe](javascript:alert(2))'} />);
    expect(document.querySelector('script')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="markdown-body"]')).toHaveTextContent('unsafe');
  });

  it('isolates safe links and exposes copyable fenced code', () => {
    render(() => <Markdown source={'[docs](https://example.com)\n\n```ts\nconst x = 1;\n```'} />);
    const link = screen.getByRole('link', { name: /docs/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    expect(document.querySelector('[data-testid="md-code-block"]')).toHaveTextContent('const x = 1;');
  });

  it('renders GFM tables, tasks, strikethrough and footnotes with table controls', () => {
    render(() => <Markdown source={'| Item | State |\n| --- | --- |\n| Build | Done |\n\n- [x] Tests\n- [ ] Release\n\n~~obsolete~~\n\nFact[^1]\n\n[^1]: Verified'} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy table' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download table as CSV' })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
    expect(document.querySelector('del')).toHaveTextContent('obsolete');
    expect(document.querySelector('[data-testid="markdown-body"] footer')).toHaveTextContent('Verified');
    expect(screen.getByText('1').closest('a')).toHaveAttribute('href', '#1');
  });

  it('copies table cells as a compact tab-separated grid', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(() => <Markdown source={'| Item | State |\n| --- | --- |\n| Build | Done |'} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy table' }));
    expect(writeText).toHaveBeenCalledWith('Item\tState\nBuild\tDone');
  });

  it('renders CJK emphasis adjacent to ideographic punctuation', () => {
    render(() => <Markdown source={'**重要提示（请注意）。**后续内容'} />);
    expect(document.querySelector('strong')).toHaveTextContent('重要提示（请注意）。');
  });

  it('renders inline and block math through accessible KaTeX output', async () => {
    render(() => <Markdown source={'Inline $x^2 + y^2$ formula.\n\n$$\nE = mc^2\n$$'} />);

    await waitFor(() => expect(document.querySelectorAll('.katex')).toHaveLength(2));
    expect(document.querySelector('[data-testid="md-math-inline"]')).toHaveAttribute('aria-label', 'x^2 + y^2');
    expect(document.querySelector('[data-testid="md-math-block"]')).toHaveAttribute('aria-label', 'E = mc^2');
    expect(document.querySelectorAll('.katex-mathml').length).toBeGreaterThan(0);
  });

  it('provides highlighted code metadata, line numbers, copy and download controls', async () => {
    render(() => <Markdown source={'```ts startLine=7 filename=answer.ts\nconst answer: number = 42;\nconsole.log(answer);\n```'} />);

    expect(screen.getByText('answer.ts')).toBeInTheDocument();
    expect(document.querySelector('[data-file-icon="typescript"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download code' })).toBeInTheDocument();
    expect(screen.getByText('7')).toHaveAttribute('data-testid', 'md-code-line-number');
    expect(screen.getByText('8')).toHaveAttribute('data-testid', 'md-code-line-number');
    await waitFor(() => expect(document.querySelector('[data-testid="md-code-block"]')).toHaveAttribute('data-highlighted', 'true'));
  });

  it('supports code blocks without line numbers and leaves unmatched prices literal', () => {
    render(() => <Markdown source={'Price is $5.\n\n```sh noLineNumbers\necho safe\n```'} />);
    expect(screen.getByText(/Price is \$5/)).toBeInTheDocument();
    expect(document.querySelector('[data-testid="md-code-line-number"]')).not.toBeInTheDocument();
  });

  it('keeps link and image safety in rendered Markdown', () => {
    render(() => <Markdown source={'[Unsafe](javascript:alert(1))\n\n![Remote](https://example.test/image.png)'} />);
    expect(screen.queryByRole('link', { name: 'Unsafe' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load image: Remote' })).toBeInTheDocument();
  });

  it('does not highlight an incomplete streaming code fence', async () => {
    render(() => <Markdown streaming source={'```ts\nconst value = 1'} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('[data-testid="md-code-block"]')).toHaveAttribute('data-highlighted', 'false');
  });

  it('unlocks and highlights a fence when its closing marker streams in', async () => {
    const [source, setSource] = createSignal('```ts\nconst value = 1;');
    render(() => <Markdown streaming source={source} />);
    expect(document.querySelector('[data-testid="md-code-block"]')).toHaveAttribute('data-incomplete', 'true');
    setSource('```ts\nconst value = 1;\n```');
    await waitFor(() => expect(document.querySelector('[data-testid="md-code-block"]')).toHaveAttribute('data-highlighted', 'true'));
    expect(document.querySelector('[data-testid="md-code-block"]')).not.toHaveAttribute('data-incomplete');
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeEnabled();
  });

  it('highlights supported TanStack Highlight languages', async () => {
    render(() => <Markdown source={'```dockerfile\nFROM node:22\n```'} />);
    await waitFor(() => expect(document.querySelector('[data-testid="md-code-block"]')).toHaveAttribute('data-highlighted', 'true'));
  });

  it('does not typeset incomplete streaming block math', async () => {
    render(() => <Markdown streaming source={'$$\nx +'} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('[data-testid="md-code-block"]')).toHaveAttribute('data-incomplete', 'true');
    expect(document.querySelector('[data-testid="md-math-inline"], [data-testid="md-math-block"]')).not.toBeInTheDocument();
  });

  it('keeps incomplete streaming code stable and locks expensive controls', () => {
    render(() => <Markdown streaming source={'```mermaid\ngraph TD\n  A --> B'} />);

    expect(screen.getByText('Mermaid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Show source' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="md-mermaid"] code')).toHaveTextContent('graph TD');
    expect(document.querySelector('[data-testid="md-code-block"]')).toHaveAttribute('data-incomplete', 'true');
  });

  it('automatically starts completed Mermaid rendering', async () => {
    render(() => <Markdown source={'```mermaid\ngraph TD\n  A --> B\n```'} />);
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(/getBBox|getComputedTextLength|could not be rendered/i);
    });
    expect(screen.getByRole('button', { name: 'Retry rendering' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Show source' })).toBeEnabled();
    expect(document.querySelector('[data-testid="md-mermaid"] code')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show source' }));
    expect(screen.getByRole('button', { name: 'Show diagram' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeEnabled();
    expect(document.querySelector('[data-testid="md-mermaid"] code')).toHaveTextContent('graph TD');
  });

  it('requires explicit consent before loading remote Markdown images', () => {
    render(() => <Markdown source={'![Architecture](https://example.com/architecture.png)'} />);
    expect(screen.getByRole('button', { name: 'Load image: Architecture' })).toBeInTheDocument();
    expect(document.querySelector('[data-testid="markdown-body"] img')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load image: Architecture' }));
    const image = screen.getByRole('img', { name: 'Architecture' });
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('never offers unsafe or malformed image protocols', () => {
    render(() => <Markdown source={'![Unsafe](javascript:alert(1))\n\n![Local](file:///etc/passwd)'} />);
    expect(screen.queryByRole('button', { name: /Load image/ })).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="markdown-body"] img')).not.toBeInTheDocument();
    expect(screen.getByText('Image unavailable: Unsafe')).toBeInTheDocument();
  });

  it('shows only the latest MCP App iframe when the same UI resource opens twice', () => {
    setPrincipalRole('full');
    let lastCommandId = '';
    installMcpApps({
      selectedCid: () => 'chat-1',
      ready: () => true,
      sendAction: (frame) => {
        lastCommandId = frame.commandId;
        return true;
      },
      acknowledge: () => undefined,
    });
    const attach = (toolCallId: string, appSessionId: string) => {
      openMcpApp('chat-1', toolCallId, {}, {});
      handleMcpAppSession({
        t: 'mcp_app_session',
        commandId: lastCommandId,
        chatId: 'chat-1',
        toolCallId,
        appSessionId,
        serverId: 'sales-dashboard',
        resourceUri: 'ui://dashboard/app.html',
      } as never);
      handleMcpAppResource({
        t: 'mcp_app_resource',
        commandId: lastCommandId,
        chatId: 'chat-1',
        appSessionId,
        html: '<html></html>',
        mimeType: 'text/html;profile=mcp-app',
      } as never);
    };
    attach('tool-1', 'app-1');
    attach('tool-2', 'app-2');
    const first = { ...baseTool('tool-1'), name: 'mcp__sales-dashboard__get_dashboard' };
    const second = { ...baseTool('tool-2'), name: 'mcp__sales-dashboard__get_dashboard' };
    render(() => <ConversationMessage entry={entry({
      origin: 'live',
      toolCalls: [first, second],
      blocks: [
        { kind: 'tool_call', id: 'tool-1', toolCall: first },
        { kind: 'tool_call', id: 'tool-2', toolCall: second },
      ],
    })} />);
    expect(screen.getAllByTitle('MCP App sandbox')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Open fullscreen' })).toBeInTheDocument();
    expect(screen.getByText(/Used mcp__sales-dashboard__get_dashboard/)).toBeInTheDocument();
  });
});
