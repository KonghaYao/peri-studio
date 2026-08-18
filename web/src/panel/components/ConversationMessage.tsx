import { createMemo, For, Show } from 'solid-js';
import type { ChatEntry } from '../lib/chat-view';
import { messageTime } from '../lib/message-time.ts';
import { CopyButton } from '../../ui';
import { Markdown } from './Markdown';
import { ToolCallCard } from './ToolCallCard';

/** Owns the visual and semantic hierarchy of one server-projected entry. */
export function ConversationMessage(props: { entry: ChatEntry }) {
  const entry = () => props.entry;
  // Replay timestamps are Hub observation time, not original message time.
  const timestamp = createMemo(() => entry().origin === 'session_replay' ? null : messageTime(entry().createdAt));
  const role = createMemo(() => entry().role === 'user' ? 'user' : entry().role === 'system' ? 'system' : 'assistant');
  const streaming = () => entry().status === 'streaming';
  const label = () => role() === 'user' ? 'Your message' : role() === 'system' ? 'System message' : 'Assistant message';

  return <article class={`conversation-message conversation-message--${role()} flex mb-12 group ${role() === 'user' ? 'justify-end' : role() === 'system' ? 'justify-center' : ''}`} aria-label={label()}>
    <div class={`conversation-message__surface min-w-0 ${role() === 'user' ? 'max-w-72p p-12 px-16 rounded-16 bg-surface-muted' : role() === 'system' ? 'max-w-70p py-4 px-12 rounded-full bg-surface-muted text-text-secondary text-12' : ''} [&>*+*]:mt-10`}>
      <Show when={role() !== 'system'}>
        <header class="conversation-message__meta flex items-center gap-6 opacity-0 text-text-muted text-12 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <Show when={timestamp()}>{(time) => <time dateTime={entry().createdAt} title={time().exact}>{time().label}</time>}</Show>
        </header>
      </Show>
      <For each={entry().reasoning}>{(reasoning) => <details class="message-reasoning text-text-secondary text-13"><summary class="cursor-pointer select-none">Thinking</summary><pre class="mt-5 ml-12 pl-12 border-l-2 border-l-divider whitespace-pre-wrap wrap-anywhere text-text-secondary font-mono text-12 leading-20">{reasoning.text}</pre></details>}</For>
      <Show when={entry().text}>
        <div class="conversation-message__text text-text-primary text-15 leading-25">
          <Show when={role() === 'assistant'} fallback={<span class="message-plain-text whitespace-pre-wrap wrap-anywhere">{entry().text}</span>}><Markdown source={entry().text} streaming={streaming()} /></Show>
        </div>
      </Show>
      <For each={entry().toolCalls}>{(toolCall) => <ToolCallCard toolCall={toolCall} />}</For>
      <For each={entry().resources}>{(resource) => <section class="message-resource p-10 px-12 rounded-10 bg-surface-muted" aria-label={resource.name || 'Related resource'}>
        <div class="flex items-baseline gap-8"><strong class="text-text-primary text-13 font-semibold">{resource.name || resource.resourceId || 'Resource'}</strong><span class="text-text-muted text-12">{resource.mediaType || 'Unknown type'}</span></div>
        <Show when={resource.resourceId}><code class="block mt-3 wrap-anywhere text-text-muted font-mono text-11 leading-145" title={resource.resourceId || undefined}>{resource.resourceId}</code></Show>
      </section>}</For>
      <Show when={entry().error}>{(error) => <section class="message-error p-10 px-12 border-l-3 border-l-danger rounded-12 bg-danger-soft text-danger" role="alert" aria-label="Message error"><code class="whitespace-pre-wrap wrap-anywhere font-mono text-12 leading-15">{error().code || 'UNKNOWN'}{error().message ? `: ${error().message}` : ''}</code></section>}</Show>
      <Show when={role() === 'user' && entry().deliveryState === 'delivery_unknown'}>
        <section class="message-delivery-warning flex flex-col gap-3 py-9 px-11 border border-warning-border rounded-10 bg-warning-soft text-text-secondary text-12 leading-15" role="alert">
          <strong class="text-text-primary font-semibold">Delivery result unknown</strong>
          <span>This message may have already run. To avoid duplicate actions, it is not resent automatically.</span>
        </section>
      </Show>
      <Show when={role() === 'user' && entry().deliveryState === 'failed_not_delivered'}>
        <section class="message-delivery-warning flex flex-col gap-3 py-9 px-11 border border-warning-border rounded-10 bg-warning-soft text-text-secondary text-12 leading-15" role="status">
          <strong class="text-text-primary font-semibold">Message not delivered</strong>
          <span>The server confirmed ACP did not run this message. Copy it and resend.</span>
        </section>
      </Show>
      <Show when={role() === 'assistant' && entry().text && !streaming()}><div class="message-actions flex min-h-28 items-center"><CopyButton class="min-h-28 px-8 border-0 rounded-7 bg-transparent text-text-muted cursor-pointer text-11 hover:bg-hover hover:text-text-primary" text={entry().text} label="Copy answer" /></div></Show>
    </div>
  </article>;
}
