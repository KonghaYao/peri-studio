import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { IoPreviewCell } from './IoPreviewCell';

const SAMPLE = { prompt: 'hello', nested: { count: 2 } };

afterEach(() => cleanup());

describe('IoPreviewCell', () => {
  it('renders empty placeholder for missing data', () => {
    render(() => <IoPreviewCell data={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders truncated single-line preview', () => {
    const long = 'x'.repeat(240);
    render(() => <IoPreviewCell data={long} maxLength={32} />);
    const button = screen.getByTestId('io-preview-cell');
    expect(button).toHaveTextContent(`${'x'.repeat(32)}…`);
  });

  it('applies input surface token', () => {
    render(() => <IoPreviewCell data={SAMPLE} variant="input" />);
    expect(screen.getByTestId('io-preview-cell')).toHaveClass('bg-surface-sunken');
  });

  it('applies output surface token', () => {
    render(() => <IoPreviewCell data={SAMPLE} variant="output" />);
    expect(screen.getByTestId('io-preview-cell')).toHaveClass('bg-success-soft');
  });

  it('opens dialog with JsonTree on click', async () => {
    render(() => <IoPreviewCell data={SAMPLE} variant="input" />);
    await fireEvent.click(screen.getByTestId('io-preview-cell'));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByTestId('io-preview-cell-tree')).toBeInTheDocument();
    expect(screen.getByText('prompt')).toBeInTheDocument();
  });
});
