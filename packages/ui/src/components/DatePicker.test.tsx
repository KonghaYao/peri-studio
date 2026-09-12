import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatePicker, DatePickerContent, DatePickerTrigger } from './DatePicker';

afterEach(() => cleanup());

const september2024 = new Date(2024, 8, 15);

describe('DatePicker', () => {
  it('renders trigger with placeholder when no value is set', () => {
    render(() => (
      <DatePicker placeholder="Select date">
        <DatePickerTrigger data-testid="trigger" />
        <DatePickerContent />
      </DatePicker>
    ));

    const trigger = screen.getByTestId('trigger');
    expect(trigger).toHaveAttribute('data-empty', 'true');
    expect(trigger).toHaveTextContent('Select date');
    expect(trigger.className).toContain('text-left');
  });

  it('opens the calendar popover and selects a date', async () => {
    const onValueChange = vi.fn();
    render(() => (
      <DatePicker defaultMonth={september2024} onValueChange={onValueChange} open>
        <DatePickerTrigger />
        <DatePickerContent aria-label="Choose date" />
      </DatePicker>
    ));

    const days = await screen.findAllByRole('button', { name: 'Sep 15, 2024' });
    fireEvent.click(days[0]);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0][0].getDate()).toBe(15);
  });

  it('shows formatted label for controlled value', () => {
    function Harness() {
      const [value] = createSignal(new Date(2024, 8, 5));
      return (
        <DatePicker value={value()} locale="en-US">
          <DatePickerTrigger data-testid="trigger" />
          <DatePickerContent />
        </DatePicker>
      );
    }

    render(() => <Harness />);
    expect(screen.getByTestId('trigger')).toHaveTextContent('Sep 5, 2024');
  });
});
