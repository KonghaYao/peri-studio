import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Transfer } from './Transfer';

afterEach(() => cleanup());

const data = [
  { key: '1', title: 'Alpha' },
  { key: '2', title: 'Beta' },
];

describe('Transfer', () => {
  it('moves items to target list', () => {
    const onChange = vi.fn();
    render(() => <Transfer dataSource={data} onChange={onChange} />);
    fireEvent.click(screen.getByText('Alpha'));
    fireEvent.click(screen.getByLabelText('Move to right'));
    expect(onChange).toHaveBeenCalledWith(['1'], 'right', ['1']);
  });
});
