import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatActivityChain } from './ChatActivityChain';

afterEach(() => cleanup());

describe('ChatActivityChain', () => {
  it('owns chain and rail classes without caller spacing', () => {
    render(() => (
      <ChatActivityChain continuesBefore continuesAfter>
        <span>row</span>
      </ChatActivityChain>
    ));

    const chain = screen.getByTestId('chat-activity-chain');
    const rail = screen.getByTestId('chat-activity-rail');
    expect(chain).toHaveClass('gap-16', 'grid');
    expect(chain).not.toHaveClass('gap-2', 'my-1', 'mb-4');
    expect(rail).toHaveClass('left-(--chat-activity-rail-left)', 'w-px', 'bg-border-strong');
    expect(rail).toHaveAttribute('data-continue-before', 'true');
    expect(rail).toHaveAttribute('data-continue-after', 'true');
  });
});
