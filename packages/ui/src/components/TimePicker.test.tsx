import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { TimePicker, TimePickerContent, TimePickerTrigger } from './TimePicker';

afterEach(() => cleanup());

describe('TimePicker', () => {
  it('renders trigger placeholder', () => {
    render(() => (
      <TimePicker placeholder="Pick time">
        <TimePickerTrigger data-testid="trigger" />
        <TimePickerContent />
      </TimePicker>
    ));
    expect(screen.getByTestId('trigger')).toHaveTextContent('Pick time');
  });
});
