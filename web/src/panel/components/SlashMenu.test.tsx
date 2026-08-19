import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { AgentCommandInfo } from '../lib/control-view';
import { SlashMenu } from './SlashMenu';

const items: AgentCommandInfo[] = [
  { name: 'review', description: 'Review the current change', kind: 'skill' },
  { name: 'compact', description: 'Compress the context', kind: 'command' },
];

describe('SlashMenu', () => {
  it('keeps the server-projected command catalog discoverable as a listbox', () => {
    render(() => <SlashMenu id="composer-slash-menu" items={items} activeIndex={0} onActiveIndex={vi.fn()} onSelect={vi.fn()} />);

    expect(screen.getByRole('listbox', { name: 'Available commands and skills' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /review.*Peri Skill/ })).toHaveAttribute('id', 'composer-slash-menu-option-0');
    expect(screen.getByText('Writes to the draft when selected; does not run immediately')).toBeInTheDocument();
  });

  it('reports the selected server-projected command to its host without executing it', () => {
    const onSelect = vi.fn();
    render(() => <SlashMenu id="composer-slash-menu" items={items} activeIndex={0} onActiveIndex={vi.fn()} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('option', { name: /compact.*Command/ }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(items[1]);
  });
});
