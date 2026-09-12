import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { UserBubble } from './UserBubble';

afterEach(() => cleanup());

describe('UserBubble', () => {
  it('renders right-aligned wireframe bubble', () => {
    render(() => <UserBubble>Hello</UserBubble>);
    const bubble = screen.getByText('Hello').closest('.border-border-subtle');
    expect(bubble).toHaveClass('max-w-(--chat-bubble-max)', 'bg-surface-overlay');
  });
});
