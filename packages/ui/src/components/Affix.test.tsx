import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Affix } from './Affix';

afterEach(() => cleanup());

describe('Affix', () => {
  it('renders affix wrapper and child content', () => {
    render(() => (
      <Affix offsetTop={0}>
        <button type="button">Pinned</button>
      </Affix>
    ));

    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="affix"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="affix-fixed"]')).toBeTruthy();
  });
});
