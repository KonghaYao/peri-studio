import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDay, toIso } from '../../lib/date-filter-boundary';
import { DateFilterInput } from './DateFilterInput';

afterEach(() => cleanup());

const september2024 = new Date(2024, 8, 15);

describe('DateFilterInput', () => {
  it('shows placeholder when inactive', () => {
    render(() => (
      <DateFilterInput
        value={undefined}
        onCommit={() => undefined}
        placeholder="From date"
        title="From"
      />
    ));

    expect(screen.getByRole('button', { name: 'From' })).toHaveTextContent('From date');
  });

  it('shows formatted day for committed ISO value', () => {
    const iso = toIso(september2024, 'start');
    render(() => (
      <DateFilterInput value={iso} onCommit={() => undefined} title="From" />
    ));

    expect(screen.getByRole('button', { name: 'From' })).toHaveTextContent(formatDay(september2024));
  });

  it('commits ISO with start boundary when a day is selected', async () => {
    const onCommit = vi.fn();
    render(() => (
      <DateFilterInput
        value={undefined}
        onCommit={onCommit}
        boundary="start"
        title="From"
        defaultMonth={september2024}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'From' }));
    const days = await screen.findAllByRole('button', { name: 'Sep 15, 2024' });
    fireEvent.click(days[0]);
    expect(onCommit).toHaveBeenCalledWith(toIso(september2024, 'start'));
  });

  it('commits ISO with end boundary when a day is selected', async () => {
    const onCommit = vi.fn();
    render(() => (
      <DateFilterInput
        value={undefined}
        onCommit={onCommit}
        boundary="end"
        title="To"
        defaultMonth={september2024}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'To' }));
    const days = await screen.findAllByRole('button', { name: 'Sep 15, 2024' });
    fireEvent.click(days[0]);
    expect(onCommit).toHaveBeenCalledWith(toIso(september2024, 'end'));
  });

  it('clears committed value', () => {
    const onCommit = vi.fn();
    const iso = toIso(september2024, 'start');
    render(() => <DateFilterInput value={iso} onCommit={onCommit} title="From" />);

    fireEvent.click(screen.getByLabelText('Clear From'));
    expect(onCommit).toHaveBeenCalledWith(undefined);
  });
});
