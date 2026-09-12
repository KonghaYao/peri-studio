import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitBranchBar } from './GitBranchBar';

afterEach(() => cleanup());

describe('GitBranchBar', () => {
  it('renders repo metadata and sync actions', () => {
    render(() => (
      <GitBranchBar
        repoName="peri-studio"
        branch="main"
        ahead={2}
        behind={1}
        hasUpstream
      />
    ));
    expect(screen.getByText('peri-studio')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('↑2')).toBeInTheDocument();
    expect(screen.getByText('↓1')).toBeInTheDocument();
  });

  it('wires pull, sync and push handlers', () => {
    const onPull = vi.fn();
    const onSync = vi.fn();
    const onPush = vi.fn();
    render(() => (
      <GitBranchBar
        repoName="peri-studio"
        branch="main"
        hasUpstream
        onPull={onPull}
        onSync={onSync}
        onPush={onPush}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Pull from upstream' }));
    fireEvent.click(screen.getByRole('button', { name: 'Synchronize changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Push to upstream' }));
    expect(onPull).toHaveBeenCalledTimes(1);
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onPush).toHaveBeenCalledTimes(1);
  });

  it('disables sync actions without upstream', () => {
    render(() => <GitBranchBar repoName="peri-studio" branch="main" />);
    expect(screen.getByRole('button', { name: 'Pull from upstream' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Synchronize changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Push to upstream' })).toBeDisabled();
  });
});
