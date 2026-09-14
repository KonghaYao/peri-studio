import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TableInlineError } from './TableInlineError';

afterEach(() => cleanup());

describe('TableInlineError', () => {
  it('renders error message with default title', () => {
    render(() => <TableInlineError error={new Error('Network timeout')} data-testid="error" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Request failed')).toBeInTheDocument();
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
  });

  it('uses stale title when refresh failed', () => {
    render(() => <TableInlineError error="upstream unavailable" isStale />);
    expect(
      screen.getByText('Could not refresh data; showing previous results.'),
    ).toBeInTheDocument();
  });

  it('invokes retry and renders action slot', () => {
    const onRetry = vi.fn();
    render(() => (
      <TableInlineError
        error={new Error('Failed')}
        onRetry={onRetry}
        action={<button type="button">Open docs</button>}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Open docs' })).toBeInTheDocument();
  });

  it('does not hardcode auth-specific actions', () => {
    render(() => <TableInlineError error={new Error('Unauthorized')} title="Unauthorized" />);
    expect(screen.queryByText(/Settings/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});
