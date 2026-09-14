import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { TruncatedIdCell } from './TruncatedIdCell';

afterEach(() => cleanup());

describe('TruncatedIdCell', () => {
  it('renders value with native title by default', () => {
    const value = 'trace_01HXYZabcdefghijklmnopqrstuvwxyz';
    render(() => <TruncatedIdCell value={value} data-testid="cell" />);
    const cell = screen.getByTestId('cell');
    expect(cell).toHaveTextContent(value);
    expect(cell).toHaveAttribute('title', value);
  });

  it('omits native title when tooltip mode is enabled', () => {
    const value = 'session_01ABCDEF';
    render(() => <TruncatedIdCell value={value} tooltip data-testid="cell" />);
    expect(screen.getByTestId('cell')).not.toHaveAttribute('title');
    expect(screen.getByText(value)).toBeInTheDocument();
  });

  it('merges custom class names', () => {
    render(() => (
      <TruncatedIdCell value="id" class="font-mono text-11" data-testid="cell" />
    ));
    expect(screen.getByTestId('cell').className).toContain('font-mono');
    expect(screen.getByTestId('cell').className).toContain('truncate');
  });
});
