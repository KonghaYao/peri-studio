import { render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { reportTransportIssue, retainPersistentErrors, setPersistentErrors, type PersistentError } from '../../panel/store';
import { ErrorCenter } from './ErrorCenter';

afterEach(() => setPersistentErrors([]));

it('never evicts unknown-result recovery cards in favor of ordinary errors', () => {
  const uncertain: PersistentError = { id: 1, title: 'Result not confirmed', detail: 'Needs confirmation via the original request', commandId: 'cmd-1', retryable: true, retrying: false };
  let errors: PersistentError[] = [uncertain];
  for (let id = 2; id <= 9; id += 1) {
    errors = retainPersistentErrors(errors, { id, title: `error ${id}`, detail: 'ordinary', commandId: null, retryable: false, retrying: false });
  }
  expect(errors).toHaveLength(5);
  expect(errors).toContainEqual(uncertain);
  expect(errors.slice(1).map((error) => error.id)).toEqual([6, 7, 8, 9]);
});

it('keeps every recovery card when more than five operations became uncertain together', () => {
  let errors: PersistentError[] = [];
  for (let id = 1; id <= 6; id += 1) {
    errors = retainPersistentErrors(errors, { id, title: `uncertain ${id}`, detail: 'blocked', commandId: `cmd-${id}`, retryable: true, retrying: false });
  }
  expect(errors.map((error) => error.id)).toEqual([1, 2, 3, 4, 5, 6]);
});

describe('ErrorCenter', () => {
  it('offers same-command confirmation only for registered uncertain actions', () => {
    setPersistentErrors([
      { id: 1, title: 'Result not confirmed', detail: 'Waiting for sync', commandId: 'safe-command', retryable: true, retrying: false },
      { id: 2, title: 'No permission', detail: 'Requires full permission', commandId: 'forbidden', retryable: false, retrying: false },
    ]);
    render(() => <ErrorCenter />);

    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getByText('Result not confirmed').closest('.error-card')).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('button', { name: 'Re-confirm with the original request' })).toBeInTheDocument();
    expect(screen.getByText('Result not confirmed').closest('.error-card')).not.toHaveTextContent('Close');
    expect(screen.getByText('No permission').closest('.error-card')).not.toHaveTextContent('Re-confirm with the original request');
  });

  it('surfaces one payload-free transport problem instead of transient toasts', () => {
    reportTransportIssue({ kind: 'malformed_frame', size: 17 });
    reportTransportIssue({ kind: 'malformed_frame', size: 29 });
    render(() => <ErrorCenter />);

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('Malformed server data received')).toBeInTheDocument();
    expect(screen.getByText(/29 characters/)).toBeInTheDocument();
  });
});
