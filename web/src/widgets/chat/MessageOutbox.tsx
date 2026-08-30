import { Show } from 'solid-js';
import type { MessageSubmission } from '../../panel/lib/message-delivery';
import { Button, CopyButton } from '@/shared/ui';

const titleFor = (phase: MessageSubmission['phase']) => phase === 'uncertain'
  ? 'Result not confirmed yet'
  : phase === 'delivery_unknown'
    ? 'Delivery result unknown, do not resend'
    : phase === 'failed'
      ? 'Message not sent'
      : '';

/** Ephemeral prompt state. It disappears only after the exact durable entry arrives. */
export function MessageOutbox(props: {
  submission: MessageSubmission;
  onRetry: () => void;
  onEdit: () => void;
  onAcknowledge?: () => void;
  acknowledgeDisabled?: boolean;
  acknowledged?: boolean;
}) {
  const actionable = () => !props.acknowledged && ['uncertain', 'delivery_unknown', 'failed'].includes(props.submission.phase);
  const inFlight = () => ['sending', 'accepted', 'committed'].includes(props.submission.phase);

  return <article
    class={`conversation-message conversation-message--user message-outbox message-outbox--${props.submission.phase} flex min-w-0 mb-12 justify-end`}
    aria-label={props.acknowledged ? 'Your unresolved message' : 'Your pending-confirmation message'}
    role={props.acknowledged ? 'group' : actionable() ? 'alert' : 'status'}
    aria-busy={inFlight() ? 'true' : undefined}
  >
    <div class={`message-outbox__surface conversation-message__surface min-w-0 max-w-72p rounded-14 border bg-surface-muted p-12 px-16 ${props.submission.phase === 'uncertain' ? 'border-warning-border' : props.submission.phase === 'failed' ? 'border-danger-border' : 'border-border-subtle'}`}>
      <div class="conversation-message__text text-text-primary text-13 leading-20"><span class="message-plain-text whitespace-pre-wrap wrap-anywhere">{props.submission.text}</span></div>
      <Show when={actionable() || props.acknowledged}>
        <footer data-testid="message-outbox-status" class="message-outbox__status flex items-center gap-7 text-text-secondary text-12 leading-14">
          <span class={`message-outbox__indicator w-7 h-7 shrink-0 rounded-full ${props.submission.phase === 'uncertain' ? 'bg-warning-strong' : props.submission.phase === 'failed' ? 'bg-danger' : 'bg-text-muted'}`} aria-hidden="true" />
          <span><strong class="text-text-primary font-semibold">{props.acknowledged ? 'Unconfirmed delivery retained' : titleFor(props.submission.phase)}</strong><Show when={props.submission.detail}> · {props.submission.detail}</Show></span>
        </footer>
        <div class="message-outbox__actions flex flex-wrap justify-end gap-6">
          <CopyButton class="pointer-coarse:min-h-44" text={props.submission.text} label="Copy original" size="compact" />
          <Show when={props.submission.retryable}>
            <Button variant="primary" size="compact" class="pointer-coarse:min-h-44" onClick={props.onRetry}>Confirm with the same request</Button>
          </Show>
          <Show when={props.submission.phase === 'failed'}>
            <Button size="compact" class="pointer-coarse:min-h-44" onClick={props.onEdit}>Back to edit</Button>
          </Show>
          <Show when={!props.acknowledged && props.submission.phase === 'delivery_unknown' && props.onAcknowledge}>
            <Button size="compact" variant="secondary" class="pointer-coarse:min-h-44" disabled={props.acknowledgeDisabled} onClick={props.onAcknowledge}>Acknowledge and continue</Button>
          </Show>
        </div>
      </Show>
    </div>
  </article>;
}
