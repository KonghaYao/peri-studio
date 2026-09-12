import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Anchor } from './Anchor';

afterEach(() => cleanup());

describe('Anchor', () => {
  it('renders anchor links from items', () => {
    render(() => (
      <Anchor
        affix={false}
        items={[
          { href: '#intro', title: 'Intro' },
          { href: '#details', title: 'Details' },
        ]}
      />
    ));

    expect(screen.getByText('Intro').closest('[data-slot="anchor-link"]')).toBeTruthy();
    expect(screen.getByRole('navigation')).toHaveAttribute('data-slot', 'anchor');
  });
});
