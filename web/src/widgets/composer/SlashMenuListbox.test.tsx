import { createSignal } from 'solid-js';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { SlashMenuListbox } from '@peri/ui';
import type { AgentCommandInfo } from '@/entities/chat/control-view';
import { agentCommandToSlashMenuItem } from '@/features/composer/slash-menu-catalog';
import { slashMenuOptionId } from '@/features/composer/slash-menu';

const items: AgentCommandInfo[] = [
  { name: 'review', description: 'Review the current change', kind: 'skill' },
  { name: 'compact', description: 'Compress the context', kind: 'command' },
];

describe('SlashMenuListbox', () => {
  it('keeps the server-projected command catalog discoverable as a listbox', () => {
    render(() => (
      <SlashMenuListbox
        id="composer-slash-menu"
        items={items}
        activeIndex={0}
        toMenuItem={agentCommandToSlashMenuItem}
        optionValue={(item) => item.name}
        optionTextValue={(item) => `${item.name} ${item.description}`}
        getOptionId={(menuId, item) => slashMenuOptionId(menuId, item.name)}
        namePrefix="/"
        onActiveIndex={vi.fn()}
        onSelect={vi.fn()}
      />
    ));

    expect(screen.getByRole('listbox', { name: 'Available commands and skills' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /review.*Review the current change/ })).toHaveAttribute('id', slashMenuOptionId('composer-slash-menu', 'review'));
    expect(screen.getByText('/review')).toBeInTheDocument();
  });

  it('highlights the active index for external keyboard navigation', () => {
    function Harness() {
      const [activeIndex, setActiveIndex] = createSignal(0);
      return (
        <>
          <SlashMenuListbox
            id="composer-slash-menu"
            items={items}
            activeIndex={activeIndex()}
            toMenuItem={agentCommandToSlashMenuItem}
            optionValue={(item) => item.name}
            optionTextValue={(item) => `${item.name} ${item.description}`}
            getOptionId={(menuId, item) => slashMenuOptionId(menuId, item.name)}
            onActiveIndex={setActiveIndex}
            onSelect={vi.fn()}
          />
          <button type="button" onClick={() => setActiveIndex(1)}>Next</button>
        </>
      );
    }
    render(() => <Harness />);
    expect(screen.getByRole('option', { name: /review.*Review the current change/ })).toHaveClass('bg-sidebar-selected');
    expect(screen.getByRole('option', { name: /compact.*Compress the context/ })).not.toHaveClass('bg-sidebar-selected');
    screen.getByRole('button', { name: 'Next' }).click();
    expect(screen.getByRole('option', { name: /compact.*Compress the context/ })).toHaveClass('bg-sidebar-selected');
  });

  it('forwards arrow keys to the host when the listbox receives focus', () => {
    const onKeyDown = vi.fn(() => true);
    render(() => (
      <SlashMenuListbox
        id="composer-slash-menu"
        items={items}
        activeIndex={0}
        toMenuItem={agentCommandToSlashMenuItem}
        optionValue={(item) => item.name}
        optionTextValue={(item) => `${item.name} ${item.description}`}
        getOptionId={(menuId, item) => slashMenuOptionId(menuId, item.name)}
        onActiveIndex={vi.fn()}
        onSelect={vi.fn()}
        onKeyDown={onKeyDown}
      />
    ));
    const listbox = screen.getByRole('listbox', { name: 'Available commands and skills' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('reports the selected server-projected command to its host without executing it', () => {
    const onSelect = vi.fn();
    render(() => (
      <SlashMenuListbox
        id="composer-slash-menu"
        items={items}
        activeIndex={0}
        toMenuItem={agentCommandToSlashMenuItem}
        optionValue={(item) => item.name}
        optionTextValue={(item) => `${item.name} ${item.description}`}
        getOptionId={(menuId, item) => slashMenuOptionId(menuId, item.name)}
        onActiveIndex={vi.fn()}
        onSelect={onSelect}
      />
    ));

    fireEvent.click(screen.getByRole('option', { name: /compact.*Compress the context/ }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(items[1]);
  });
});
