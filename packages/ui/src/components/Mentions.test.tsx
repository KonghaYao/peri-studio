import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Mentions } from './Mentions';

afterEach(() => cleanup());

describe('Mentions', () => {
  it('renders textarea', () => {
    render(() => (
      <Mentions
        options={[{ value: 'alice', label: 'Alice' }]}
        placeholder="Mention someone"
        data-testid="mentions"
      />
    ));
    expect(screen.getByPlaceholderText('Mention someone')).toBeInTheDocument();
  });
});
