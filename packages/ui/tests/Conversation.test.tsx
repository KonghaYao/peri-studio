import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Copy } from 'lucide-solid';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Conversation,
  ConversationContent,
  ConversationDownload,
  ConversationEmptyState,
  ConversationScrollButton,
  messagesToMarkdown,
} from '../src/components/Conversation';
import {
  Message,
  MessageAction,
  MessageActions,
  MessageBranch,
  MessageBranchContent,
  MessageBranchNext,
  MessageBranchPage,
  MessageBranchPrevious,
  MessageBranchSelector,
  MessageContent,
  MessageToolbar,
} from '../src/components/Message';
import { Shimmer } from '../src/components/Shimmer';

afterEach(() => cleanup());

describe('Conversation utilities', () => {
  it('formats messages to markdown with default role labels', () => {
    const markdown = messagesToMarkdown([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', parts: [{ type: 'text', text: 'Hi there' }] },
    ]);

    expect(markdown).toBe('**User:** Hello\n\n**Assistant:** Hi there');
  });

  it('downloads conversation markdown from the floating button', () => {
    const click = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:conversation');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'a') {
        element.click = click;
      }
      return element;
    });

    render(() => (
      <Conversation>
        <ConversationContent>
          <p>Hello</p>
        </ConversationContent>
        <ConversationDownload messages={[{ role: 'user', content: 'Hello' }]} filename="chat.md" />
      </Conversation>
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Download conversation' }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:conversation');
  });
});

describe('Conversation layout', () => {
  it('wraps provider and scroller slots', () => {
    render(() => (
      <Conversation class="conversation-root">
        <ConversationContent>
          <p>First message</p>
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    ));

    expect(document.querySelector('[data-slot="message-scroller"]')).toHaveClass('conversation-root');
    expect(screen.getByRole('region', { name: 'Messages' })).toBeInTheDocument();
    expect(screen.getByRole('log')).toHaveTextContent('First message');
    expect(screen.getByRole('button', { name: 'Scroll to end' })).toBeInTheDocument();
  });

  it('renders empty state with default copy', () => {
    render(() => (
      <Conversation>
        <ConversationContent>
          <ConversationEmptyState />
        </ConversationContent>
      </Conversation>
    ));

    expect(screen.getByText('No messages yet')).toBeInTheDocument();
    expect(screen.getByText('Start a conversation to see messages here')).toBeInTheDocument();
  });
});

describe('Message branch and actions', () => {
  it('maps from=user to end alignment and exposes branch navigation', () => {
    render(() => (
      <Message from="user">
        <MessageContent>
          <MessageBranch defaultBranch={0}>
            <MessageBranchContent>
              <p>Branch A</p>
              <p>Branch B</p>
            </MessageBranchContent>
            <MessageToolbar>
              <MessageBranchSelector>
                <MessageBranchPrevious />
                <MessageBranchPage />
                <MessageBranchNext />
              </MessageBranchSelector>
              <MessageActions>
                <MessageAction tooltip="Copy" label="Copy">
                  <Copy size={14} aria-hidden="true" />
                </MessageAction>
              </MessageActions>
            </MessageToolbar>
          </MessageBranch>
        </MessageContent>
      </Message>
    ));

    expect(document.querySelector('[data-slot="message"]')).toHaveAttribute('data-from', 'user');
    expect(document.querySelector('[data-slot="message"]')).toHaveAttribute('data-align', 'end');
    expect(screen.getByText('Branch A')).toBeInTheDocument();
    expect(screen.queryByText('Branch B')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next branch' }));
    expect(screen.getByText('Branch B')).toBeInTheDocument();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
  });
});

describe('Shimmer', () => {
  it('renders shimmer utility with optional duration override', () => {
    render(() => (
      <Shimmer duration={1} class="custom-shimmer">
        Thinking...
      </Shimmer>
    ));

    const shimmer = screen.getByText('Thinking...');
    expect(shimmer).toHaveAttribute('data-slot', 'shimmer');
    expect(shimmer).toHaveClass('ui-ai-shimmer', 'custom-shimmer');
    expect(shimmer).toHaveStyle({ '--shimmer-duration': '1s' });
  });
});
