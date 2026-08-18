import { Show } from 'solid-js';
import type { MessageSubmission } from '../lib/message-delivery';
import { Button, CopyButton } from '../../components/ui';

const titleFor = (phase: MessageSubmission['phase']) => phase === 'uncertain'
  ? 'Result not confirmed yet'
  : phase === 'delivery_unknown'
    ? 'Delivery result unknown, do not resend'
  : phase === 'failed'
    ? 'Message not sent'
    : phase === 'committed'
      ? 'Syncing message'
      : phase === 'accepted'
        ? 'Received by server'
        : 'Sending';

/** Ephemeral prompt state. It disappears only after the exact durable entry arrives. */
export function MessageOutbox(props: {
  submission: MessageSubmission;
  onRetry: () => void;
  onEdit: () => void;
}) {
  const actionable = () => ['uncertain', 'delivery_unknown', 'failed'].includes(props.submission.phase);

  return <article
    class={`conversation-message conversation-message--user message-outbox message-outbox--${props.submission.phase} flex mb-12 justify-end`}
    aria-label="Your pending-confirmation message"
    role={actionable() ? 'alert' : 'status'}
  >
    <div class={`conversation-message__surface min-w-0 max-w-72p p-12 px-16 rounded-16 border border-dashed [&>*+*]:mt-10 ${props.submission.phase === 'uncertain' ? 'border-warning-border bg-warning-soft' : props.submission.phase === 'failed' ? 'border-danger-border bg-danger-soft' : 'border-strong bg-surface-muted'}`}>
      <div class="conversation-message__text text-text-primary text-15 leading-25"><span class="message-plain-text whitespace-pre-wrap wrap-anywhere">{props.submission.text}</span></div>
      <footer class="message-outbox__status flex items-center gap-7 text-text-secondary text-12 leading-14">
        <span class={`message-outbox__indicator w-7 h-7 shrink-0 rounded-full ${props.submission.phase === 'uncertain' ? 'bg-warning-strong' : props.submission.phase === 'failed' ? 'bg-danger' : 'bg-text-muted'}`} aria-hidden="true" />
        <span><strong class="text-text-primary font-semibold">{titleFor(props.submission.phase)}</strong><Show when={props.submission.detail}> · {props.submission.detail}</Show></span>
      </footer>
      <Show when={actionable()}>
        <div class="message-outbox__actions flex flex-wrap justify-end gap-6">
          <CopyButton class="pointer-coarse:min-h-44" text={props.submission.text} label="Copy original" size="compact" />
          <Show when={props.submission.retryable}>
            <Button variant="primary" size="compact" class="pointer-coarse:min-h-44" onClick={props.onRetry}>Confirm with the same request</Button>
          </Show>
          <Show when={props.submission.phase === 'failed'}>
            <Button size="compact" class="pointer-coarse:min-h-44" onClick={props.onEdit}>Back to edit</Button>
          </Show>
        </div>
      </Show>
    </div>
  </article>;
}
