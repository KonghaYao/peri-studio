import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShortcutsDialogShell } from './ShortcutsDialogShell';

afterEach(() => cleanup());

describe('ShortcutsDialogShell', () => {
  it('renders shortcut entries when open', () => {
    render(() => (
      <ShortcutsDialogShell
        open
        onOpenChange={() => undefined}
        shortcuts={[
          { keys: ['⌘', 'K'], label: 'Open command palette' },
          { keys: ['?'], label: 'Show keyboard shortcuts' },
        ]}
      />
    ));

    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByText('Open command palette')).toBeInTheDocument();
    expect(screen.getByText('Show keyboard shortcuts')).toBeInTheDocument();
    expect(screen.getByText('⌘')).toBeInTheDocument();
    expect(screen.getByText('K')).toBeInTheDocument();
  });

  it('calls onOpenChange(false) on Escape', () => {
    const onOpenChange = vi.fn();
    render(() => (
      <ShortcutsDialogShell
        open
        onOpenChange={onOpenChange}
        shortcuts={[{ keys: ['Esc'], label: 'Close dialog' }]}
      />
    ));

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Keyboard shortcuts' }), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
