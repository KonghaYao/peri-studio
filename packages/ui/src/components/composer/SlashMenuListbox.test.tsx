import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlashMenuItem } from './SlashMenu';
import { SlashMenuListbox } from './SlashMenuListbox';

type MockItem = { id: string; label: string; description: string };

const mockItems: MockItem[] = [
  { id: 'alpha', label: 'Alpha', description: 'First command' },
  { id: 'beta', label: 'Beta', description: 'Second command' },
  { id: 'gamma', label: 'Gamma', description: 'Third command' },
];

function toMenuItem(item: MockItem): SlashMenuItem {
  return { name: item.label, description: item.description };
}

function renderSlashMenu(overrides: Partial<Parameters<typeof SlashMenuListbox<MockItem>>[0]> = {}) {
  const onActiveIndex = vi.fn();
  const onSelect = vi.fn();

  render(() => (
    <SlashMenuListbox
      id="test-slash-menu"
      items={mockItems}
      activeIndex={0}
      toMenuItem={toMenuItem}
      optionValue={(item) => item.id}
      optionTextValue={(item) => `${item.label} ${item.description}`}
      onActiveIndex={onActiveIndex}
      onSelect={onSelect}
      {...overrides}
    />
  ));

  return { onActiveIndex, onSelect };
}

afterEach(() => cleanup());

describe('SlashMenuListbox', () => {
  it('exposes listbox semantics and default shell test id', () => {
    renderSlashMenu();

    expect(screen.getByRole('listbox', { name: 'Available commands and skills' })).toBeInTheDocument();
    expect(screen.getByTestId('slash-menu')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(mockItems.length);
  });

  it('highlights the active option', () => {
    renderSlashMenu({ activeIndex: 1 });

    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[0]).not.toHaveClass('bg-sidebar-selected');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveClass('bg-sidebar-selected');
  });

  it('calls onSelect with the clicked item', () => {
    const { onSelect } = renderSlashMenu();

    fireEvent.click(screen.getAllByRole('option')[1]!);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(mockItems[1]);
  });

  it('forwards keydown events to onKeyDown', () => {
    const onKeyDown = vi.fn();
    renderSlashMenu({ onKeyDown });

    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0]?.[0]).toMatchObject({ key: 'ArrowDown' });
  });

  it('renders name prefix before option labels', () => {
    renderSlashMenu({ namePrefix: '/' });

    expect(screen.getByText('/Alpha')).toBeInTheDocument();
    expect(screen.getByText('/Beta')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });
});
