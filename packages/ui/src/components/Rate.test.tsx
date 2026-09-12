import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Rate } from './Rate';

afterEach(() => cleanup());

describe('Rate', () => {
  it('selects star rating', () => {
    const onChange = vi.fn();
    render(() => <Rate onChange={onChange} />);
    const stars = screen.getAllByRole('radio');
    fireEvent.pointerDown(stars[2]);
    expect(onChange).toHaveBeenCalledWith(3);
  });
});
