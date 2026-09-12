import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Cascader } from './Cascader';

afterEach(() => cleanup());

describe('Cascader', () => {
  it('renders placeholder', () => {
    render(() => (
      <Cascader
        options={[{ value: 'zhejiang', label: 'Zhejiang', children: [{ value: 'hangzhou', label: 'Hangzhou' }] }]}
        placeholder="Select region"
        data-testid="cascader"
      />
    ));
    expect(screen.getByTestId('cascader')).toHaveTextContent('Select region');
  });
});
