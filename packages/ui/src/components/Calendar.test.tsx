import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Calendar, CalendarGrid, CalendarHeader } from './Calendar';

afterEach(() => cleanup());

const september2024 = new Date(2024, 8, 15);

describe('Calendar', () => {
  it('renders weekday headers and day buttons for the visible month', () => {
    render(() => (
      <Calendar defaultMonth={september2024} data-testid="calendar">
        <CalendarHeader />
        <CalendarGrid />
      </Calendar>
    ));

    expect(screen.getByTestId('calendar')).toHaveClass('border-border-subtle', 'bg-surface');
    expect(screen.getByText('September 2024')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'Sep 15, 2024' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sep 1, 2024' })).toBeInTheDocument();
  });

  it('selects a day and highlights it with accent styles', () => {
    const onValueChange = vi.fn();
    render(() => (
      <Calendar defaultMonth={september2024} onValueChange={onValueChange}>
        <CalendarGrid />
      </Calendar>
    ));

    const day = screen.getByRole('button', { name: 'Sep 10, 2024' });
    fireEvent.click(day);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0][0].getDate()).toBe(10);
    expect(day).toHaveAttribute('aria-selected', 'true');
    expect(day.className).toContain('bg-accent-solid');
    expect(day.className).toContain('text-content-on-accent');
  });

  it('navigates to the previous and next months', () => {
    render(() => (
      <Calendar defaultMonth={september2024}>
        <CalendarHeader />
        <CalendarGrid />
      </Calendar>
    ));

    expect(screen.getByText('September 2024')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText('August 2024')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('September 2024')).toBeInTheDocument();
  });

  it('marks outside-month days and respects disabled matchers', () => {
    const march2024 = new Date(2024, 2, 15);
    const disabled = new Date(2024, 2, 20);
    render(() => (
      <Calendar defaultMonth={march2024} disabled={disabled}>
        <CalendarGrid />
      </Calendar>
    ));

    const outsideDay = screen.getByRole('button', { name: 'Feb 29, 2024' });
    expect(outsideDay).toHaveAttribute('data-outside', 'true');
    expect(outsideDay.className).toContain('text-content-muted');

    const disabledDay = screen.getByRole('button', { name: 'Mar 20, 2024' });
    expect(disabledDay).toBeDisabled();
    expect(disabledDay).toHaveAttribute('aria-disabled', 'true');
  });

  it('supports controlled value', () => {
    const selected = new Date(2024, 8, 12);
    render(() => (
      <Calendar value={selected} defaultMonth={september2024}>
        <CalendarGrid />
      </Calendar>
    ));

    expect(screen.getByRole('button', { name: 'Sep 12, 2024' })).toHaveAttribute('aria-selected', 'true');
  });
});
