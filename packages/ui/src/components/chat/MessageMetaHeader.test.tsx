import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageMetaHeader } from './MessageMetaHeader';

afterEach(() => cleanup());

describe('MessageMetaHeader', () => {
  it('renders hover-reveal meta row', () => {
    render(() => (
      <MessageMetaHeader>
        <time>12:00</time>
      </MessageMetaHeader>
    ));

    const header = screen.getByTestId('conversation-message-meta');
    expect(header).toHaveClass('flex', 'opacity-0', 'group-hover/message:opacity-100');
    expect(header).toHaveTextContent('12:00');
  });
});
