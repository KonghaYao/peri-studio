import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatHeader } from './ChatHeader';

afterEach(() => cleanup());

describe('ChatHeader', () => {
  it('keeps the title in launch mode so the WCO overlay is not an empty white slab', () => {
    render(() => <ChatHeader title="New conversation" launch />);

    const header = screen.getByTestId('titlebar-drag-chat');
    expect(header).toHaveClass('ui-titlebar-drag', 'pl-titlebar-content');
    expect(header).not.toHaveClass(
      'ui-titlebar-overlay',
      'ui-titlebar-sidebar',
      'min-h-titlebar',
      'pt-titlebar',
      'bg-surface-overlay',
    );
    expect(screen.getByText('New conversation')).toHaveClass('ui-titlebar-no-drag');
  });
});
