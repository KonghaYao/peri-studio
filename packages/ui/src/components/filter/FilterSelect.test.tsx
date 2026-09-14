import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FILTER_SELECT_ALL, FilterSelect } from './FilterSelect';

afterEach(() => cleanup());

describe('FilterSelect', () => {
  const options = [
    { value: 'generation', label: 'Generation' },
    { value: 'span', label: 'Span' },
  ];

  it('shows all label when value is undefined', () => {
    render(() => (
      <FilterSelect
        value={undefined}
        onCommit={() => undefined}
        allLabel="All types"
        options={options}
      />
    ));

    expect(screen.getByText('All types')).toBeInTheDocument();
  });

  it('commits option value immediately on selection', async () => {
    const onCommit = vi.fn();
    render(() => (
      <FilterSelect
        value={undefined}
        onCommit={onCommit}
        allLabel="All types"
        options={options}
        aria-label="Type filter"
      />
    ));

    const trigger = screen.getByRole('button', { name: /Type filter/ });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Span' }));
    expect(onCommit).toHaveBeenCalledWith('span');
  });

  it('commits undefined when ALL sentinel is selected', async () => {
    const onCommit = vi.fn();
    render(() => (
      <FilterSelect
        value="generation"
        onCommit={onCommit}
        allLabel="All types"
        options={options}
        aria-label="Type filter"
      />
    ));

    const trigger = screen.getByRole('button', { name: /Type filter/ });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'All types' }));
    expect(onCommit).toHaveBeenCalledWith(undefined);
  });

  it('exports stable ALL sentinel', () => {
    expect(FILTER_SELECT_ALL).toBe('__all__');
  });
});
