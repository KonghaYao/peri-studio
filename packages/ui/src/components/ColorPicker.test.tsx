import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ColorPicker } from './ColorPicker';

afterEach(() => cleanup());

describe('ColorPicker', () => {
  it('renders trigger with default color', () => {
    render(() => <ColorPicker showText data-testid="picker" />);
    expect(screen.getByTestId('picker')).toBeInTheDocument();
    expect(screen.getByText('#1677ff')).toBeInTheDocument();
  });
});
