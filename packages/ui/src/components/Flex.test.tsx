import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Flex } from './Flex';

afterEach(() => cleanup());

describe('Flex', () => {
  it('renders with data-slot and vertical layout', () => {
    render(() => (
      <Flex vertical data-testid="flex">
        <span>One</span>
        <span>Two</span>
      </Flex>
    ));

    const flex = screen.getByTestId('flex');
    expect(flex).toHaveAttribute('data-slot', 'flex');
    expect(flex).toHaveClass('flex-col');
  });

  it('applies justify and align variants', () => {
    render(() => (
      <Flex justify="center" align="center" data-testid="flex">
        Content
      </Flex>
    ));

    const flex = screen.getByTestId('flex');
    expect(flex).toHaveClass('justify-center', 'items-center');
  });
});
