import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Space } from './Space';

afterEach(() => cleanup());

describe('Space', () => {
  it('renders horizontal space with items', () => {
    render(() => (
      <Space data-testid="space">
        <button type="button">A</button>
        <button type="button">B</button>
      </Space>
    ));

    const space = screen.getByTestId('space');
    expect(space).toHaveAttribute('data-slot', 'space');
    expect(space.querySelectorAll('[data-slot="space-item"]').length).toBe(2);
  });

  it('supports vertical orientation', () => {
    render(() => (
      <Space vertical data-testid="space">
        <span>A</span>
        <span>B</span>
      </Space>
    ));

    expect(screen.getByTestId('space')).toHaveClass('flex-col');
  });
});
