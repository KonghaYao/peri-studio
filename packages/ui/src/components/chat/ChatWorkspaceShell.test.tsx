import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatWorkspaceShell } from './ChatWorkspaceShell';

afterEach(() => cleanup());

describe('ChatWorkspaceShell', () => {
  it('renders launch mode without composer stack', () => {
    render(() => (
      <ChatWorkspaceShell
        launch
        data-testid="chat-view"
        header={<header data-testid="hdr">Header</header>}
        launchBody={<div data-testid="launch">Launch</div>}
      />
    ));

    expect(screen.getByTestId('chat-view')).toHaveClass('chat-view--launch', 'ui-chat-workspace--launch');
    expect(screen.getByTestId('launch')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-stack')).not.toBeInTheDocument();
  });

  it('renders session transcript and composer stack slots', () => {
    render(() => (
      <ChatWorkspaceShell
        data-testid="chat-view"
        transcript={<div data-testid="transcript">Messages</div>}
        composerStack={<div data-testid="composer-inner">Composer</div>}
      />
    ));

    expect(screen.getByTestId('chat-view')).not.toHaveClass('chat-view--launch');
    expect(screen.getByTestId('transcript')).toBeInTheDocument();
    expect(screen.getByTestId('composer-stack')).toBeInTheDocument();
    expect(screen.getByTestId('composer-stack')).toHaveClass('overflow-visible');
    expect(screen.getByTestId('composer-stack')).not.toHaveClass('overflow-x-hidden');
    expect(screen.getByTestId('composer-inner')).toBeInTheDocument();
  });
});
