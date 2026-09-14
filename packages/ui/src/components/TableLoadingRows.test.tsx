import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { TableLoadingRows } from './TableLoadingRows';

afterEach(() => cleanup());

describe('TableLoadingRows', () => {
  it('renders configurable skeleton rows and columns', () => {
    const { container } = render(() => (
      <TableLoadingRows data-testid="loading-rows" rows={2} columns={3} />
    ));

    expect(screen.getByTestId('loading-rows')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(container.querySelectorAll('td')).toHaveLength(6);
    expect(container.querySelectorAll('.ui-skeleton')).toHaveLength(6);
  });

  it('defaults to eight rows and four columns', () => {
    const { container } = render(() => <TableLoadingRows />);
    expect(screen.getAllByRole('row')).toHaveLength(8);
    expect(container.querySelectorAll('td')).toHaveLength(32);
  });
});
