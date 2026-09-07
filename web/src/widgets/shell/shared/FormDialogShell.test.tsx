import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Dialog, DialogContent } from '@/shared/ui';
import { FormDialogShell } from './FormDialogShell';

afterEach(cleanup);

describe('FormDialogShell', () => {
  it('renders visible heading and description with sr-only dialog title', () => {
    render(() => (
      <Dialog open>
        <DialogContent>
          <FormDialogShell
            title="Add computer"
            description="Uses OpenSSH on this Mac."
          >
            <input aria-label="Destination" />
          </FormDialogShell>
        </DialogContent>
      </Dialog>
    ));

    expect(screen.getByRole('heading', { name: 'Add computer' })).toBeInTheDocument();
    expect(screen.getByText('Uses OpenSSH on this Mac.')).toBeInTheDocument();
    expect(screen.getByLabelText('Destination')).toBeInTheDocument();
  });
});
