import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Alert, AlertDescription, AlertTitle } from './Alert';

afterEach(() => cleanup());

describe('Alert', () => {
  it('renders typed alert with icon and close action', () => {
    const onDismiss = vi.fn();
    render(() => (
      <Alert type="warning" closable onDismiss={onDismiss}>
        <AlertTitle>Warning</AlertTitle>
        <AlertDescription>Check delivery state.</AlertDescription>
      </Alert>
    ));
    expect(screen.getByRole('status')).toHaveAttribute('data-type', 'warning');
    fireEvent.click(screen.getByRole('button', { name: 'Close alert' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
