import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { MessageSubmission } from '@/features/message/message-delivery';
import { MessageOutbox } from './MessageOutbox';

const submission = (phase: MessageSubmission['phase']): MessageSubmission => ({
  commandId: 'command-1',
  text: 'do not lose this work',
  sessionId: 'session-1',
  chatId: 'chat-1',
  draftOwner: { principalId: 'principal-1', projectId: 'project-1', sessionId: 'session-1' },
  phase,
  detail: phase === 'uncertain' ? 'The server has not confirmed the result yet.' : null,
  retryable: phase === 'uncertain',
  projected: false,
});

describe('MessageOutbox', () => {
  it('keeps the full message visible and offers only the identity-safe retry', () => {
    const retry = vi.fn();
    render(() => <MessageOutbox submission={submission('uncertain')} onRetry={retry} onEdit={vi.fn()} />);
    expect(screen.getByRole('alert', { name: 'Your pending-confirmation message' })).toHaveTextContent('do not lose this work');
    expect(screen.getByText('Result not confirmed yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with the same request' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Back to edit' })).not.toBeInTheDocument();
  });

  it('returns a definite failure to editing without offering unsafe retry', () => {
    const edit = vi.fn();
    render(() => <MessageOutbox submission={submission('failed')} onRetry={vi.fn()} onEdit={edit} />);
    expect(screen.queryByRole('button', { name: 'Confirm with the same request' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to edit' }));
    expect(edit).toHaveBeenCalledOnce();
  });

  it('keeps non-actionable transport progress quiet while exposing busy state', () => {
    render(() => <MessageOutbox submission={submission('sending')} onRetry={vi.fn()} onEdit={vi.fn()} />);

    const status = screen.getByRole('status', { name: 'Your pending-confirmation message' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('do not lose this work');
    expect(status).not.toHaveTextContent('Sending');
    expect(status.querySelector('[data-testid="message-outbox-status"]')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps delivery-unknown visible and offers only explicit acknowledge-and-continue', () => {
    const acknowledge = vi.fn();
    render(() => <MessageOutbox submission={submission('delivery_unknown')} onRetry={vi.fn()} onEdit={vi.fn()} onAcknowledge={acknowledge} />);
    expect(screen.getByText('Delivery result unknown, do not resend')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy original' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm with the same request' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to edit' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge and continue' }));
    expect(acknowledge).toHaveBeenCalledOnce();
  });

  it('renders acknowledged evidence without announcing it as a new alert', () => {
    render(() => <MessageOutbox acknowledged submission={submission('delivery_unknown')} onRetry={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Your unresolved message' })).toHaveTextContent('do not lose this work');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
