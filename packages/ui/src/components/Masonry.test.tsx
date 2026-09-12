import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Masonry } from './Masonry';

afterEach(() => cleanup());

describe('Masonry', () => {
  it('renders items in columns', () => {
    render(() => (
      <Masonry
        data-testid="masonry"
        columns={2}
        items={[
          { key: 'a', children: <div>A</div> },
          { key: 'b', children: <div>B</div> },
          { key: 'c', children: <div>C</div> },
        ]}
      />
    ));

    const masonry = screen.getByTestId('masonry');
    expect(masonry).toHaveAttribute('data-slot', 'masonry');
    expect(masonry.querySelectorAll('[data-slot="masonry-item"]').length).toBe(3);
  });
});
