import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageSurfaceShell } from './MessageSurfaceShell';

afterEach(() => cleanup());

describe('MessageSurfaceShell', () => {
  it('renders assistant surface width', () => {
    render(() => <MessageSurfaceShell from="assistant">Answer</MessageSurfaceShell>);
    expect(screen.getByTestId('conversation-message-surface')).toHaveClass('w-full', 'conversation-message__surface');
  });

  it('renders system pill surface', () => {
    render(() => <MessageSurfaceShell from="system">Notice</MessageSurfaceShell>);
    expect(screen.getByTestId('conversation-message-surface')).toHaveClass(
      'rounded-full',
      'bg-surface-muted',
      'max-w-(--chat-system-max)',
    );
  });
});
