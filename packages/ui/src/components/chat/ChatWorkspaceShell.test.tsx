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

    expect(screen.getByTestId('chat-view')).toHaveAttribute('data-launch', 'true');
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

    expect(screen.getByTestId('chat-view')).not.toHaveAttribute('data-launch');
    expect(screen.getByTestId('transcript')).toBeInTheDocument();
    expect(screen.getByTestId('composer-stack')).toBeInTheDocument();
    expect(screen.getByTestId('composer-stack')).toHaveClass('overflow-visible', 'max-h-(--container-composer-stack-max)');
    expect(screen.getByTestId('composer-stack')).not.toHaveClass('overflow-x-hidden');
    expect(screen.getByTestId('composer-inner')).toBeInTheDocument();
  });
});
