import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { ChatEntry } from '../lib/chat-view';
import { ConversationMessage } from './ConversationMessage';

function entry(overrides: Partial<ChatEntry> = {}): ChatEntry {
  return {
    id: 'entry-1', turnId: 'turn-1', kind: 'message', role: 'assistant', status: 'completed', authorUserId: null, sourceCommandId: null,
    origin: 'live', replayVerified: null, createdAt: '2026-08-13T12:00:00Z', completedAt: '2026-08-13T12:00:01Z', text: '', reasoning: [], toolCalls: [], resources: [], error: null,
    ...overrides,
  };
}

describe('ConversationMessage', () => {
  it('keeps user text plain and visually separate from assistant Markdown', () => {
    const view = render(() => <ConversationMessage entry={entry({ role: 'user', text: '**literal user input**' })} />);
    const message = screen.getByLabelText('Your message');
    expect(message).toHaveClass('conversation-message--user');
    expect(message).toHaveTextContent('**literal user input**');
    expect(message.querySelector('strong')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy answer' })).not.toBeInTheDocument();
    view.unmount();
  });

  it('renders completed assistant content as a coding reader with copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(() => <ConversationMessage entry={entry({ text: '## Result\n\n`cargo test` passed.' })} />);

    expect(screen.getByLabelText('Assistant message')).toHaveClass('conversation-message--assistant');
    expect(screen.getByRole('heading', { name: 'Result' })).toBeInTheDocument();
    expect(screen.getByText('cargo test')).toHaveClass('md-inline-code');
    fireEvent.click(screen.getByRole('button', { name: 'Copy answer' }));
    expect(writeText).toHaveBeenCalledWith('## Result\n\n`cargo test` passed.');
  });

  it('keeps streaming assistant text plain and exposes no copy action yet', () => {
    render(() => <ConversationMessage entry={entry({ status: 'streaming', text: '**partial' })} />);
    expect(screen.getByText('**partial')).toHaveClass('message-plain-text');
    expect(screen.queryByRole('button', { name: 'Copy answer' })).not.toBeInTheDocument();
    expect(document.querySelector('.message-loading')).toHaveAttribute('aria-hidden', 'true');
  });

  it('presents reasoning, resources and errors as distinct evidence layers', () => {
    render(() => <ConversationMessage entry={entry({
      reasoning: [{ text: 'checked repository state', visibility: 'visible' }],
      resources: [{ resourceId: 'file:///workspace/src/main.rs', mediaType: 'text/rust', name: 'main.rs' }],
      error: { code: 'TOOL_FAILED', message: 'exit 1' },
    })} />);

    expect(screen.getByText('Thinking').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('checked repository state')).toBeInTheDocument();
    expect(screen.getByLabelText('main.rs')).toHaveTextContent('text/rust');
    expect(screen.getByTitle('file:///workspace/src/main.rs')).toBeInTheDocument();
    expect(screen.getByRole('alert', { name: 'Message error' })).toHaveTextContent('TOOL_FAILED: exit 1');
  });

  it('gives an empty projected assistant entry one quiet progress announcement', () => {
    render(() => <ConversationMessage entry={entry({ status: 'pending' })} />);
    expect(screen.getByText('Generating answer')).toHaveClass('sr-only');
    expect(document.querySelectorAll('.message-loading')).toHaveLength(1);
  });

  it('keeps a reloaded unknown user delivery visibly blocked from retry', () => {
    render(() => <ConversationMessage entry={entry({
      role: 'user',
      status: 'pending',
      text: 'potentially executed prompt',
      deliveryState: 'delivery_unknown',
      deliveryErrorCode: 'DELIVERY_UNKNOWN',
    })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Delivery result unknown');
    expect(screen.getByRole('alert')).toHaveTextContent('not resent automatically');
  });

  it('does not present Hub observation time as the original time of restored history', () => {
    render(() => <ConversationMessage entry={entry({
      origin: 'session_replay', replayVerified: true, text: 'older answer', createdAt: new Date().toISOString(),
    })} />);
    expect(screen.getByLabelText('Assistant message').querySelector('time')).toBeNull();
  });
});
