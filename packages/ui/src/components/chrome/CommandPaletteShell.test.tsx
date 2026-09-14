import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommandPaletteShell,
  bindCommandPaletteHotkey,
  bindCommandPaletteOpenEvent,
  bindShortcutsHelpHotkey,
  dispatchCommandPaletteOpen,
} from './CommandPaletteShell';

afterEach(() => cleanup());

describe('CommandPaletteShell', () => {
  it('filters and selects commands', () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(() => (
      <CommandPaletteShell
        open
        onOpenChange={onOpenChange}
        items={[
          { id: 'traces', label: 'Traces', keywords: 'list', onSelect },
          { id: 'settings', label: 'Settings', onSelect: vi.fn() },
        ]}
      />
    ));

    const input = screen.getByLabelText('Search commands');
    fireEvent.input(input, { target: { value: 'trace' } });
    expect(screen.getByText('Traces')).toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Traces'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('navigates with arrow keys and closes on escape', () => {
    const onOpenChange = vi.fn();
    render(() => (
      <CommandPaletteShell
        open
        onOpenChange={onOpenChange}
        items={[
          { id: 'alpha', label: 'Alpha', onSelect: vi.fn() },
          { id: 'beta', label: 'Beta', onSelect: vi.fn() },
        ]}
      />
    ));

    const input = screen.getByLabelText('Search commands');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Beta/i })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows default keyboard hint footer', () => {
    render(() => (
      <CommandPaletteShell
        open
        onOpenChange={() => undefined}
        items={[{ id: 'alpha', label: 'Alpha', onSelect: vi.fn() }]}
      />
    ));

    expect(screen.getByText(/↑↓ Navigate/)).toBeInTheDocument();
    expect(screen.getByText(/Esc Close/)).toBeInTheDocument();
  });

  it('hides footer when footer is null', () => {
    render(() => (
      <CommandPaletteShell
        open
        footer={null}
        onOpenChange={() => undefined}
        items={[{ id: 'alpha', label: 'Alpha', onSelect: vi.fn() }]}
      />
    ));

    expect(screen.queryByText(/↑↓ Navigate/)).not.toBeInTheDocument();
  });

  it('wraps active index at list boundaries', () => {
    render(() => (
      <CommandPaletteShell
        open
        onOpenChange={() => undefined}
        items={[
          { id: 'alpha', label: 'Alpha', onSelect: vi.fn() },
          { id: 'beta', label: 'Beta', onSelect: vi.fn() },
          { id: 'gamma', label: 'Gamma', onSelect: vi.fn() },
        ]}
      />
    ));

    const input = screen.getByLabelText('Search commands');
    expect(screen.getByRole('option', { name: /Alpha/i })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: /Gamma/i })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Alpha/i })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: /Beta/i })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Alpha/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('does not select disabled items', () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(() => (
      <CommandPaletteShell
        open
        onOpenChange={onOpenChange}
        items={[
          { id: 'enabled', label: 'Enabled', onSelect: vi.fn() },
          { id: 'disabled', label: 'Disabled action', disabled: true, onSelect },
        ]}
      />
    ));

    const input = screen.getByLabelText('Search commands');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Disabled action/i })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Disabled action'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe('bindCommandPaletteHotkey', () => {
  it('toggles on Cmd/Ctrl+K', () => {
    const onToggle = vi.fn();
    const cleanupHotkey = bindCommandPaletteHotkey(onToggle);

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    fireEvent.keyDown(document, { key: 'K', ctrlKey: true });
    expect(onToggle).toHaveBeenCalledTimes(2);

    cleanupHotkey();
  });
});

describe('bindCommandPaletteOpenEvent', () => {
  it('opens when dispatchCommandPaletteOpen fires', () => {
    const onOpen = vi.fn();
    const cleanupListener = bindCommandPaletteOpenEvent(onOpen);

    dispatchCommandPaletteOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);

    cleanupListener();
  });
});

describe('bindShortcutsHelpHotkey', () => {
  it('opens on ? outside typing targets', () => {
    const onOpen = vi.fn();
    const cleanupHotkey = bindShortcutsHelpHotkey(onOpen);

    fireEvent.keyDown(window, { key: '?' });
    expect(onOpen).toHaveBeenCalledTimes(1);

    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: '?' });
    expect(onOpen).toHaveBeenCalledTimes(1);

    input.remove();
    cleanupHotkey();
  });
});
