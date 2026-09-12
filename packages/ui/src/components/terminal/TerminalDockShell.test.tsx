import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { TerminalDockShell } from './TerminalDockShell';

afterEach(() => cleanup());

describe('TerminalDockShell', () => {
  it('renders dock slots and collapse control', async () => {
    const [expanded, setExpanded] = createSignal(true);

    render(() => (
      <TerminalDockShell
        data-testid="terminal-dock"
        aria-label="Terminal dock"
        expanded={expanded()}
        onExpandedChange={setExpanded}
        title={<span>zsh</span>}
        headerActions={<button type="button">Restart</button>}
        status={<span data-testid="status">Running</span>}
        footer={<span data-testid="footer-meta">Bound to peri-studio</span>}
        viewport={<div data-testid="viewport">PTY output</div>}
      />
    ));

    const shell = screen.getByTestId('terminal-dock');
    expect(shell).toHaveClass('ui-terminal-dock-shell');
    expect(shell).toHaveAttribute('aria-label', 'Terminal dock');
    expect(screen.getByText('zsh')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    expect(screen.getByTestId('status')).toBeInTheDocument();
    expect(screen.getByTestId('footer-meta')).toBeInTheDocument();
    expect(screen.getByTestId('viewport')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Collapse terminal viewport' }));
    expect(expanded()).toBe(false);
    expect(screen.getByTestId('viewport')).toBeInTheDocument();
    expect(screen.getByTestId('viewport').closest('.ui-terminal-dock-shell__viewport')).toHaveClass(
      'ui-terminal-dock-shell__viewport--collapsed',
    );
  });

  it('omits collapse control without onExpandedChange', () => {
    render(() => (
      <TerminalDockShell
        aria-label="Terminal"
        title={<span>Terminal</span>}
        viewport={<div data-testid="viewport">Output</div>}
      />
    ));

    expect(screen.queryByRole('button', { name: 'Collapse terminal viewport' })).not.toBeInTheDocument();
    expect(screen.getByTestId('viewport')).toBeInTheDocument();
  });
});
