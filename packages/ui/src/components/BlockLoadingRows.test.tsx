import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockLoadingRows } from './BlockLoadingRows';

afterEach(() => cleanup());

describe('BlockLoadingRows', () => {
  it('renders configurable skeleton rows', () => {
    const { container } = render(() => (
      <BlockLoadingRows data-testid="block-loading" rows={3} />
    ));

    expect(screen.getByTestId('block-loading')).toHaveAttribute('role', 'status');
    expect(container.querySelectorAll('.ui-skeleton')).toHaveLength(3);
  });

  it('defaults to four rows', () => {
    const { container } = render(() => <BlockLoadingRows />);
    expect(container.querySelectorAll('.ui-skeleton')).toHaveLength(4);
  });
});
