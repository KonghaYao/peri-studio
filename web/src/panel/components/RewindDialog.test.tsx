import { render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { setRewindFlow } from '../lib/rewind-assembly';
import { RewindDialog } from './RewindDialog';

afterEach(() => setRewindFlow({ kind: 'closed' }));

describe('RewindDialog', () => {
  it('shows target selection before any destructive confirmation', () => {
    setRewindFlow({
      kind: 'select_target', chatId: 'chat-1',
      candidates: [{ messageId: 'message-1', preview: 'Fix the login flow' }],
    });
    render(() => <RewindDialog open onClose={() => undefined} />);
    const target = screen.getByRole('option', { name: /Fix the login flow/ });
    expect(screen.getByRole('listbox', { name: 'Rewind target message' })).toContainElement(target);
    expect(screen.queryByRole('button', { name: 'Rewind session and files' })).not.toBeInTheDocument();
  });

  it('shows normalized file impact only after a fingerprint-bound preview', () => {
    setRewindFlow({
      kind: 'confirm', chatId: 'chat-1', candidates: [],
      candidate: { messageId: 'message-1', preview: 'Fix the login flow' },
      previewFingerprint: 'a'.repeat(64),
      fileChanges: [{ path: 'src/main.rs', kind: 'edit' }],
    });
    render(() => <RewindDialog open onClose={() => undefined} />);
    expect(screen.getByText('src/main.rs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rewind session and files' })).toBeInTheDocument();
  });

  it('never offers retry when execution delivery is unknown', () => {
    setRewindFlow({ kind: 'delivery_unknown', chatId: 'chat-1', detail: 'The server has not confirmed the result yet.' });
    render(() => <RewindDialog open onClose={() => undefined} />);
    expect(screen.getByRole('alert')).toHaveTextContent('re-execution is not offered');
    expect(screen.queryByRole('button', { name: /retry|re-execute|query again/i })).not.toBeInTheDocument();
  });
});
