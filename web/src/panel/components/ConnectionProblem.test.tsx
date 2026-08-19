import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setBusy, setConnectionProblem } from '../lib/connection';

vi.mock('../lib/connection', async (original) => {
  const actual = await original<typeof import('../lib/connection')>();
  return { ...actual, reconnect: vi.fn() };
});

import { reconnect } from '../lib/connection';
import { ConnectionProblem } from './ConnectionProblem';

afterEach(() => {
  setBusy(false);
  setConnectionProblem(null);
  vi.mocked(reconnect).mockClear();
});

describe('ConnectionProblem', () => {
  it('prevents duplicate reconnect attempts and exposes progress', () => {
    setConnectionProblem({ code: 4501, title: 'Connection timed out', detail: 'The session is still safe.', action: 'reconnect' });
    const view = render(() => <ConnectionProblem />);

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(reconnect).toHaveBeenCalledOnce();

    setBusy(true);
    const button = screen.getByRole('button', { name: /Connecting/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(reconnect).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('does not invent a reconnect action for login failures', () => {
    setConnectionProblem({ code: 4502, title: 'Sign-in expired', detail: 'Please sign in again.', action: 'login' });
    render(() => <ConnectionProblem />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Please sign in again.');
    expect(alert).toHaveClass('ui-inline-notice', 'ui-inline-notice--danger');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
