import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IoViewer, IoViewerShell } from './IoViewerShell';

const CHAT_PAYLOAD = {
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi' },
  ],
};

const TOOL_PAYLOAD = {
  messages: [
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu1', name: 'grep', input: { pattern: 'foo' } }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'match found' }],
    },
  ],
};

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => cleanup());

describe('IoViewerShell', () => {
  it('renders JSON view for non-chat payloads without toggle', () => {
    render(() => <IoViewerShell data={{ model: 'gpt-4' }} />);

    expect(screen.getByTestId('io-viewer-json')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.getByTestId('io-viewer-shell').querySelector('[data-view-mode="json"]')).toBeTruthy();
  });

  it('defaults to chat view with role labels for chat payloads', () => {
    render(() => <IoViewerShell data={CHAT_PAYLOAD} />);

    expect(screen.getByRole('radiogroup', { name: 'View mode' })).toBeInTheDocument();
    expect(screen.getByTestId('chat-io-list')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByText('Assistant')).toBeInTheDocument();
    expect(screen.getByText('3 messages')).toBeInTheDocument();
  });

  it('shows full Chat and JSON labels without truncation', () => {
    render(() => <IoViewerShell data={CHAT_PAYLOAD} />);

    expect(screen.getByRole('radio', { name: 'Chat' })).toHaveTextContent('Chat');
    expect(screen.getByRole('radio', { name: 'JSON' })).toHaveTextContent('JSON');
  });

  it('switches to JSON view when JSON tab is selected', async () => {
    const onModeChange = vi.fn();
    render(() => <IoViewerShell data={CHAT_PAYLOAD} onModeChange={onModeChange} />);

    await fireEvent.click(screen.getByRole('radio', { name: 'JSON' }));

    expect(screen.getByTestId('io-viewer-json')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-io-list')).not.toBeInTheDocument();
    expect(onModeChange).toHaveBeenCalledWith('json');
    expect(screen.getByTestId('io-viewer-shell').querySelector('[data-view-mode="json"]')).toBeTruthy();
  });

  it('parses string-wrapped JSON before detection', () => {
    render(() => <IoViewerShell data={JSON.stringify(CHAT_PAYLOAD)} />);
    expect(screen.getByTestId('chat-io-list')).toBeInTheDocument();
  });

  it('routes empty payloads to JSON empty state', () => {
    render(() => <IoViewerShell data={null} />);
    expect(screen.getByText('(empty)')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('routes unparseable string payloads to JSON primitive view', () => {
    render(() => <IoViewerShell data="not-json" />);
    expect(screen.getByText('not-json')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('absorbs Anthropic tool_result user messages into the matching tool call', () => {
    render(() => <IoViewerShell data={TOOL_PAYLOAD} />);
    expect(screen.queryByText('Tool')).not.toBeInTheDocument();
    expect(screen.getByText('grep')).toBeInTheDocument();
    expect(screen.getByText('match found')).toBeInTheDocument();
  });

  it('supports optional renderChat and renderJson overrides', () => {
    const renderJson = vi.fn(() => <div data-testid="custom-json">json</div>);
    const renderChat = vi.fn(() => <div data-testid="custom-chat">chat</div>);

    render(() => (
      <IoViewerShell
        data={CHAT_PAYLOAD}
        renderJson={renderJson}
        renderChat={renderChat}
      />
    ));

    expect(screen.getByTestId('custom-chat')).toBeInTheDocument();
    expect(renderChat).toHaveBeenCalled();
  });

  it('exposes IoViewer alias with default self-rendering', () => {
    render(() => <IoViewer data={CHAT_PAYLOAD} />);
    expect(screen.getByTestId('chat-io-list')).toBeInTheDocument();
  });
});

describe('ChatIoList behaviors', () => {
  it('shows system and developer message content by default', () => {
    render(() => (
      <IoViewerShell
        data={{
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'developer', content: 'Prefer JSON output.' },
            { role: 'user', content: 'Hello' },
          ],
        }}
      />
    ));
    expect(screen.queryByText(/click to expand/)).not.toBeInTheDocument();
    expect(screen.getByText('You are helpful.')).toBeInTheDocument();
    expect(screen.getByText('Prefer JSON output.')).toBeInTheDocument();
  });

  it('shows full long text without truncation', () => {
    const longText = 'x'.repeat(1300);
    render(() => (
      <IoViewerShell
        data={{
          messages: [{ role: 'user', content: longText }],
        }}
      />
    ));
    expect(screen.queryByText('Show more…')).not.toBeInTheDocument();
    expect(screen.getByText(longText)).toBeInTheDocument();
  });

  it('loads earlier messages progressively', async () => {
    const messages = Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message ${index + 1}`,
    }));
    render(() => <IoViewerShell data={{ messages }} />);

    expect(screen.queryByText('message 1')).not.toBeInTheDocument();
    expect(screen.getByText(/message 25/)).toBeInTheDocument();
    await fireEvent.click(screen.getByText(/Load .* earlier messages/));
    expect(screen.getByText('message 1')).toBeInTheDocument();
  });

  it('shows consecutive unpaired tool messages without grouping collapse', () => {
    render(() => (
      <IoViewerShell
        data={{
          messages: [
            { role: 'tool', tool_call_id: 'orphan_a', content: 'a' },
            { role: 'tool', tool_call_id: 'orphan_b', content: 'b' },
          ],
        }}
      />
    ));

    expect(screen.queryByText(/consecutive Tool messages/)).not.toBeInTheDocument();
    const list = screen.getByTestId('chat-io-list');
    expect(within(list).getAllByText('Tool')).toHaveLength(2);
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });

  it('shows thinking and tool call content by default', () => {
    render(() => (
      <IoViewerShell
        data={{
          messages: [{
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'Plan the response carefully.' },
              { type: 'tool_use', id: 'tu1', name: 'grep', input: { pattern: 'foo' } },
            ],
          }],
        }}
      />
    ));

    expect(screen.getByText('Plan the response carefully.')).toBeInTheDocument();
    expect(screen.getByText(/"pattern": "foo"/)).toBeInTheDocument();
  });

  it('merges tool results into assistant tool calls instead of separate tool bubbles', () => {
    render(() => (
      <IoViewerShell
        data={{
          messages: [
            {
              role: 'assistant',
              content: [
                { type: 'tool_use', id: 'tu_schema', name: 'read_schema', input: { path: 'docs/a.md' } },
              ],
              tool_calls: [{
                id: 'tc_read',
                function: { name: 'grep', arguments: '{"pattern":"messages"}' },
              }],
            },
            {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: 'tu_schema', content: '{"ok":true}' }],
            },
            {
              role: 'tool',
              name: 'grep',
              tool_call_id: 'tc_read_0123456789ab',
              content: 'packages/web/src/shared/components/chat-utils.ts:36',
            },
          ],
        }}
      />
    ));

    expect(screen.queryByText(/consecutive Tool messages/)).not.toBeInTheDocument();
    expect(screen.getByText('read_schema')).toBeInTheDocument();
    expect(screen.getByText('grep')).toBeInTheDocument();
    expect(screen.getAllByText('Result')).toHaveLength(2);
    expect(screen.getByText('{"ok":true}')).toBeInTheDocument();
    expect(screen.getByText('packages/web/src/shared/components/chat-utils.ts:36')).toBeInTheDocument();
    expect(screen.getAllByText('Assistant')).toHaveLength(1);
  });
});
