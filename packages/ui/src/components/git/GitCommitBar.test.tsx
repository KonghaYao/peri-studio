import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitCommitBar } from './GitCommitBar';

afterEach(() => cleanup());

describe('GitCommitBar', () => {
  it('commits on Enter in single-line mode', () => {
    const onCommit = vi.fn();
    render(() => <GitCommitBar stagedCount={1} onCommit={onCommit} />);
    const input = screen.getByRole('textbox', { name: 'Commit message' });
    fireEvent.input(input, { target: { value: 'Ship it' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('commits on Ctrl+Enter in multi-line mode', () => {
    const onCommit = vi.fn();
    render(() => <GitCommitBar stagedCount={1} rows={2} onCommit={onCommit} />);
    const input = screen.getByRole('textbox', { name: 'Commit message' });
    fireEvent.input(input, { target: { value: 'Ship it' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('shows max byte validation and disables commit', () => {
    const onCommit = vi.fn();
    render(() => <GitCommitBar stagedCount={1} rows={2} maxBytes={4} onCommit={onCommit} />);
    const input = screen.getByRole('textbox', { name: 'Commit message' });
    fireEvent.input(input, { target: { value: '界界界界界' } });
    expect(screen.getByRole('alert')).toHaveTextContent('4 UTF-8 bytes');
    expect(screen.getByRole('button', { name: 'Commit staged changes' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
