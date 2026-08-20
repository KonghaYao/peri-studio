import { createMemo, For, Show, type Accessor } from 'solid-js';
import type { ChatEntry } from '../lib/chat-view';
import { messageTime } from '../lib/message-time.ts';
import { splitSystemReminders } from '../lib/system-reminder';
import { CopyButton, InlineNotice } from '../../components/ui';
import { Markdown } from './Markdown';
import { ToolCallCard } from './ToolCallCard';

type ChatEntrySource = ChatEntry | Accessor<ChatEntry>;

/** Owns the visual and semantic hierarchy of one server-projected entry. */
export function ConversationMessage(props: { entry: ChatEntrySource }) {
  const entry = () => typeof props.entry === 'function' ? props.entry() : props.entry;
  const reasoningIds = createMemo(() => entry().reasoning.map((reasoning, index) => reasoning.id || `${entry().id}:reasoning:${index}`));
  const reasoningById = createMemo(() => new Map(entry().reasoning.map((reasoning, index) => [reasoning.id || `${entry().id}:reasoning:${index}`, reasoning])));
  const toolCallIds = createMemo(() => entry().toolCalls.map((toolCall, index) => toolCall.toolCallId || `${entry().id}:tool:${index}`));
  const toolCallsById = createMemo(() => new Map(entry().toolCalls.map((toolCall, index) => [toolCall.toolCallId || `${entry().id}:tool:${index}`, toolCall])));
  // Replay timestamps are Hub observation time, not original message time.
  const timestamp = createMemo(() => entry().origin === 'session_replay' ? null : messageTime(entry().createdAt));
  const role = createMemo(() => entry().role === 'user' ? 'user' : entry().role === 'system' ? 'system' : 'assistant');
  const streaming = () => entry().status === 'streaming';
  const userSegments = createMemo(() => splitSystemReminders(entry().text));
  const label = () => role() === 'user' ? 'Your message' : role() === 'system' ? 'System message' : 'Assistant message';

  return <article class={`conversation-message conversation-message--${role()} ${role() === 'assistant' ? 'conversation-message--timeline relative pl-0 before:hidden' : ''} flex mb-12 group ${role() === 'user' ? 'justify-end' : role() === 'system' ? 'justify-center' : ''}`} aria-label={label()}>
    <Show when={role() === 'assistant'}><span class="conversation-message__timeline-mark hidden" aria-hidden="true" /></Show>
    <div class={`conversation-message__surface min-w-0 ${role() === 'user' ? 'max-w-72p border border-border-subtle p-12 px-16 rounded-14 bg-surface-muted' : role() === 'system' ? 'max-w-[70%] py-4 px-12 rounded-full bg-surface-muted text-text-secondary text-12' : ''} [&>*+*]:mt-10`}>
      <Show when={role() !== 'system'}>
        <header class={`conversation-message__meta flex items-center gap-6 text-text-muted text-12 transition-opacity duration-150 ${role() === 'assistant' ? 'conversation-message__meta--assistant min-h-18 opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
          <Show when={role() === 'assistant'}><span class="conversation-message__author text-text-primary text-11 font-680 tracking-2">Peri</span></Show>
          <Show when={timestamp()}>{(time) => <time dateTime={entry().createdAt} title={time().exact}>{time().label}</time>}</Show>
        </header>
      </Show>
      <For each={reasoningIds()}>{(id) => {
        const reasoning = () => reasoningById().get(id)!;
        return <details class="message-reasoning text-text-secondary text-13"><summary class="cursor-pointer select-none">Thinking</summary><pre class="mt-5 ml-12 pl-12 border-l-2 border-l-divider whitespace-pre-wrap wrap-anywhere text-text-secondary font-mono text-12 leading-20">{reasoning().text}</pre></details>;
      }}</For>
      <div class="conversation-message__text text-text-primary text-14 leading-22">
        <Show when={role() === 'assistant'} fallback={<For each={userSegments()}>{(segment) =>
          <Show when={segment.kind === 'system_reminder'} fallback={<span class="message-plain-text whitespace-pre-wrap wrap-anywhere">{segment.text}</span>}>
            <InlineNotice class="system-reminder-message my-8 max-w-full text-left!" tone="info" title="Untrusted system reminder" aria-label="Untrusted system reminder">
              <p class="whitespace-pre-wrap wrap-anywhere">{segment.text}</p>
            </InlineNotice>
          </Show>
        }</For>}>
          <Markdown source={() => entry().text} streaming={streaming()} />
        </Show>
      </div>
      <For each={toolCallIds()}>{(id) => <ToolCallCard toolCall={() => toolCallsById().get(id)!} />}</For>
      <For each={entry().resources}>{(resource) => <section class="message-resource p-10 px-12 rounded-10 bg-surface-muted" aria-label={resource.name || 'Related resource'}>
        <div class="flex items-baseline gap-8"><strong class="text-text-primary text-13 font-semibold">{resource.name || resource.resourceId || 'Resource'}</strong><span class="text-text-muted text-12">{resource.mediaType || 'Unknown type'}</span></div>
        <Show when={resource.resourceId}><code class="block mt-3 wrap-anywhere text-text-muted font-mono text-11 leading-145" title={resource.resourceId || undefined}>{resource.resourceId}</code></Show>
      </section>}</For>
      <Show when={entry().error}>{(error) => <InlineNotice tone="danger" role="alert" aria-label="Message error"><code class="whitespace-pre-wrap wrap-anywhere font-mono text-12 leading-15">{error().code || 'UNKNOWN'}{error().message ? `: ${error().message}` : ''}</code></InlineNotice>}</Show>
      <Show when={role() === 'user' && entry().deliveryState === 'delivery_unknown'}>
        <InlineNotice tone="warning" role="alert" title="Delivery result unknown">
          <span>This message may have already run. To avoid duplicate actions, it is not resent automatically.</span>
        </InlineNotice>
      </Show>
      <Show when={role() === 'user' && entry().deliveryState === 'failed_not_delivered'}>
        <InlineNotice tone="warning" role="status" title="Message not delivered">
          <span>The server confirmed ACP did not run this message. Copy it and resend.</span>
        </InlineNotice>
      </Show>
      <Show when={role() === 'assistant' && entry().text && !streaming()}><div class="flex items-center"><CopyButton size="compact" text={entry().text} label="Copy answer" /></div></Show>
    </div>
  </article>;
}
