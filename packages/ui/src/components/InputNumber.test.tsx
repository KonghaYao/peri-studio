import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputNumber } from './InputNumber';

afterEach(() => cleanup());

describe('InputNumber', () => {
  it('increments with step controls', () => {
    const onChange = vi.fn();
    render(() => <InputNumber defaultValue={1} step={2} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Increase'));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('respects controlled value', () => {
    render(() => {
      const [value] = createSignal(5);
      return <InputNumber value={value()} readOnly />;
    });
    expect(screen.getByRole('textbox')).toHaveValue('5');
  });
});
