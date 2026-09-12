import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageSquare } from 'lucide-solid';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '../src/components/Conversation';

afterEach(() => cleanup());

describe('Conversation', () => {
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

  it('renders empty state with Empty compound components', () => {
    render(() => (
      <Conversation>
        <ConversationContent>
          <ConversationEmptyState
            icon={<MessageSquare data-testid="empty-icon" />}
            title="Start a conversation"
            description="Type a message below to begin chatting"
          />
        </ConversationContent>
      </Conversation>
    ));

    expect(screen.getByText('Start a conversation')).toHaveAttribute('data-slot', 'empty-title');
    expect(screen.getByText('Type a message below to begin chatting')).toHaveAttribute(
      'data-slot',
      'empty-description',
    );
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="conversation-empty-state"]')).toBeInTheDocument();
  });
});
