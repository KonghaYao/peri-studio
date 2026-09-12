import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { TreeSelect } from './TreeSelect';

afterEach(() => cleanup());

describe('TreeSelect', () => {
  it('renders placeholder', () => {
    render(() => (
      <TreeSelect
        treeData={[{ value: 'parent', title: 'Parent', children: [{ value: 'child', title: 'Child' }] }]}
        placeholder="Select node"
        data-testid="tree-select"
      />
    ));
    expect(screen.getByTestId('tree-select')).toHaveTextContent('Select node');
  });
});
