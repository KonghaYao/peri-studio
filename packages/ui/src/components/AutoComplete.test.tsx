import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { AutoComplete } from './AutoComplete';

afterEach(() => cleanup());

describe('AutoComplete', () => {
  it('renders input with placeholder', () => {
    render(() => (
      <AutoComplete
        options={[{ value: 'a', label: 'Alpha' }]}
        placeholder="Type here"
        data-testid="ac"
      />
    ));
    expect(screen.getByTestId('ac')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type here')).toBeInTheDocument();
  });
});
