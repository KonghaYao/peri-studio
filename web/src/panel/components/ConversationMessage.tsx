import { createMemo, createSignal, For, Show, type Accessor } from 'solid-js';
import type { ChatBlock, ChatEntry } from '../lib/chat-view';
import { messageTime } from '../lib/message-time.ts';
import { splitSystemReminders } from '../lib/system-reminder';
import { CopyButton, IconButton, InlineNotice, Popover, PopoverContent, PopoverTrigger } from '../../components/ui';
import { MessageSquareQuote, MoreHorizontal } from 'lucide-solid';
import { Markdown } from './Markdown';
import { ToolCallCard } from './ToolCallCard';
import { requestComposerQuote } from '../lib/composer-quote';

type ChatEntrySource = ChatEntry | Accessor<ChatEntry>;

function QuoteIcon() {
  return <MessageSquareQuote size={16} strokeWidth={1.7} />;
}

function SystemReminderBadge(props: { reminders: string[] }) {
  return <Popover placement="bottom-start">
    <PopoverTrigger type="button" class="system-reminder-badge inline-flex h-20 cursor-pointer items-center rounded-6 border border-border-subtle bg-surface-muted px-7 text-11 font-600 text-text-secondary hover:bg-hover pointer-coarse:min-h-44" aria-label="System message">
      System
    </PopoverTrigger>
    <PopoverContent class="system-reminder-popover max-h-[min(420px,calc(100vh-32px))] w-[min(520px,calc(100vw-32px))] overflow-auto" aria-label="System message">
      <For each={props.reminders}>{(reminder, index) =>
        <p class={`${index() === 0 ? 'm-0' : 'm-0 mt-10'} whitespace-pre-wrap wrap-anywhere text-12 leading-19 text-text-secondary`}>{reminder}</p>
      }</For>
    </PopoverContent>
  </Popover>;
}

/** Owns the visual and semantic hierarchy of one server-projected entry. */
export function ConversationMessage(props: { entry: ChatEntrySource }) {
  let articleRef: HTMLElement | undefined;
  const [selectionAction, setSelectionAction] = createSignal<{ text: string; left: number; top: number } | null>(null);
  const [actionsOpen, setActionsOpen] = createSignal(false);
  const entry = () => typeof props.entry === 'function' ? props.entry() : props.entry;
  const legacyBlocks = (): ChatBlock[] => [
    ...entry().reasoning.map((reasoning, index) => ({ kind: 'reasoning' as const, id: reasoning.id || `${entry().id}:reasoning:${index}`, reasoning })),
    ...(entry().text ? [{ kind: 'text' as const, id: `${entry().id}:text`, text: entry().text }] : []),
    ...entry().toolCalls.map((toolCall, index) => ({ kind: 'tool_call' as const, id: toolCall.toolCallId || `${entry().id}:tool:${index}`, toolCall })),
    ...entry().resources.map((resource, index) => ({ kind: 'resource' as const, id: resource.resourceId || `${entry().id}:resource:${index}`, resource })),
  ];
  // 旧快照与开发 fixture 可能尚无 blocks；只在该兼容边界回退到旧分组模型。
  const blocks = createMemo(() => entry().blocks?.length ? entry().blocks : legacyBlocks());
  const blockIds = createMemo(() => blocks().map((block) => block.id));
  const blocksById = createMemo(() => new Map(blocks().map((block) => [block.id, block])));
  const systemReminders = createMemo(() => blocks().flatMap((block) => block.kind === 'text'
    ? splitSystemReminders(block.text).flatMap((segment) => segment.kind === 'system_reminder' ? [segment.text] : [])
    : []));
  // Replay timestamps are Hub observation time, not original message time.
  const timestamp = createMemo(() => entry().origin === 'session_replay' ? null : messageTime(entry().createdAt));
  const role = createMemo(() => entry().role === 'user' ? 'user' : entry().role === 'system' ? 'system' : 'assistant');
  const streaming = () => entry().status === 'streaming';
  const actionsId = () => `message-actions-${entry().id}`;
  const label = () => role() === 'user' ? 'Your message' : role() === 'system' ? 'System message' : 'Assistant message';
  const partialTerminal = createMemo(() => {
    if (role() !== 'assistant' || !(entry().text || entry().reasoning.length || entry().toolCalls.length || entry().resources.length)) return null;
    const status = String(entry().status || '').toLowerCase();
    if (status === 'failed') return { label: 'Response failed', state: 'failed', tone: 'danger' as const };
    if (status === 'interrupted') return { label: 'Response interrupted', state: 'interrupted', tone: 'warning' as const };
    if (status === 'cancelled' || status === 'canceled') return { label: 'Response cancelled', state: 'cancelled', tone: 'warning' as const };
    return null;
  });
  const copyText = () => partialTerminal()
    ? `${entry().text}\n\n[Partial response: ${partialTerminal()!.state}]`
    : entry().text;
  const quoteSource = () => role() === 'user' ? 'You' : role() === 'system' ? 'System' : 'Peri';
  const captureSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !articleRef) {
      setSelectionAction(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!articleRef.contains(range.commonAncestorContainer)) {
      setSelectionAction(null);
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      setSelectionAction(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setSelectionAction({
      text,
      left: Math.max(12, Math.min(window.innerWidth - 12, rect.left + rect.width / 2)),
      top: Math.max(12, rect.top - 8),
    });
  };
  const addQuote = (text: string) => {
    if (!requestComposerQuote(text, quoteSource())) return;
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
  };

  return <article ref={articleRef} onMouseUp={captureSelection} onKeyUp={captureSelection} onFocusOut={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActionsOpen(false);
  }} class={`conversation-message conversation-message--${role()} group/message relative mb-12 flex ${role() === 'assistant' ? 'conversation-message--timeline pl-0 before:hidden' : ''} ${role() === 'user' ? 'justify-end' : role() === 'system' ? 'justify-center' : ''}`} aria-label={label()}>
    <Show when={role() === 'assistant'}><span class="conversation-message__timeline-mark hidden" aria-hidden="true" /></Show>
    <div class={`conversation-message__surface min-w-0 ${role() === 'user' ? 'max-w-72p border border-border-subtle py-8 px-12 rounded-12 bg-surface-muted' : role() === 'system' ? 'max-w-[70%] py-4 px-12 rounded-full bg-surface-muted text-text-secondary text-12' : 'w-full'} [&>*+*]:mt-10 [&>.tool-card+.tool-card]:mt-0`}>
      <Show when={role() === 'user'}>
        <header class="conversation-message__meta pointer-events-none absolute -top-17 right-0 flex items-center gap-7 text-10 text-text-muted opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 group-focus-within/message:opacity-100">
          <Show when={timestamp()}>{(time) => <time dateTime={entry().createdAt} title={time().exact}>{time().label}</time>}</Show>
        </header>
      </Show>
      <For each={blockIds()}>{(id) => {
        const block = () => blocksById().get(id)!;
        return <Show when={block().kind === 'reasoning'} fallback={
          <Show when={block().kind === 'text'} fallback={
            <Show when={block().kind === 'tool_call'} fallback={
              <section class="message-resource p-10 px-12 rounded-10 bg-surface-muted" aria-label={(block() as Extract<ChatBlock, { kind: 'resource' }>).resource.name || 'Related resource'}>
                {(() => {
                  const resource = () => (block() as Extract<ChatBlock, { kind: 'resource' }>).resource;
                  return <><div class="flex items-baseline gap-8"><strong class="text-text-primary text-13 font-semibold">{resource().name || resource().resourceId || 'Resource'}</strong><span class="text-text-muted text-12">{resource().mediaType || 'Unknown type'}</span></div><Show when={resource().resourceId}><code class="block mt-3 wrap-anywhere text-text-muted font-mono text-11 leading-145" title={resource().resourceId || undefined}>{resource().resourceId}</code></Show></>;
                })()}
              </section>
            }>{<ToolCallCard toolCall={() => (block() as Extract<ChatBlock, { kind: 'tool_call' }>).toolCall} />}</Show>
          }>{
            <div class="conversation-message__text text-text-primary text-13 leading-20">
              <Show when={role() === 'assistant'} fallback={<For each={splitSystemReminders((block() as Extract<ChatBlock, { kind: 'text' }>).text)}>{(segment) =>
                <Show when={segment.kind === 'text'}>
                  <span class="message-plain-text whitespace-pre-wrap wrap-anywhere">{segment.text}</span>
                </Show>
              }</For>}>
                <Markdown
                  source={() => (block() as Extract<ChatBlock, { kind: 'text' }>).text}
                  streaming={streaming()}
                />
              </Show>
            </div>
          }</Show>
        }>{(() => {
          const reasoning = () => (block() as Extract<ChatBlock, { kind: 'reasoning' }>).reasoning;
          return <details class="message-reasoning max-w-[680px] text-text-secondary"><summary class="inline-flex min-h-24 cursor-pointer list-none items-center select-none text-11 font-650 tracking-2 text-text-muted hover:text-text-secondary [&::-webkit-details-marker]:hidden">Thinking</summary><p class="m-0 mt-3 whitespace-pre-wrap wrap-anywhere text-12 leading-19 text-text-secondary">{reasoning().text}</p></details>;
        })()}</Show>;
      }}</For>
      <Show when={role() === 'user' && systemReminders().length > 0}>
        <SystemReminderBadge reminders={systemReminders()} />
      </Show>
      <Show when={partialTerminal()}>{(terminal) => <InlineNotice tone={terminal().tone} role="status" title="Partial response">
        <span>{terminal().label}. The output above may be incomplete.</span>
      </InlineNotice>}</Show>
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
      <Show when={role() === 'assistant' && entry().text && !streaming()}><>
        <IconButton label="Message actions" size="compact" variant="ghost" class="conversation-message__actions-trigger absolute top-0 right-0 z-10 hidden min-h-44 min-w-44 border-0 bg-surface text-text-muted shadow-subtle pointer-coarse:inline-flex" aria-expanded={actionsOpen()} aria-controls={actionsId()} onClick={() => setActionsOpen((open) => !open)}><MoreHorizontal size={17} strokeWidth={1.7} /></IconButton>
        <div id={actionsId()} class={`conversation-message__actions absolute top-full left-0 z-20 flex min-h-30 items-center gap-2 rounded-8 border border-border-subtle bg-surface px-4 py-1 text-text-muted shadow-popover transition-opacity duration-150 ${actionsOpen() ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}><CopyButton size="compact" text={copyText()} label="Copy answer" class="border-0 bg-transparent text-text-muted hover:bg-hover pointer-coarse:min-h-44" /><IconButton label="Quote answer" size="compact" variant="ghost" class="border-0 bg-transparent text-text-muted hover:bg-hover pointer-coarse:min-h-44 pointer-coarse:min-w-44" onClick={() => addQuote(copyText())}><QuoteIcon /></IconButton><span class="ml-5 text-11 font-600 text-text-muted">Peri</span><Show when={timestamp()}>{(time) => <time class="text-11 text-text-faint" dateTime={entry().createdAt} title={time().exact}>{time().label}</time>}</Show></div>
      </></Show>
    </div>
    <Show when={selectionAction()}>{(action) => <IconButton
      label="Add selection to conversation"
      variant="primary"
      class="fixed z-50 w-36 min-h-30 -translate-x-1/2 -translate-y-full rounded-7 border-0 bg-btn-primary p-0 text-surface shadow-popover"
      style={{ left: `${action().left}px`, top: `${action().top}px` }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => addQuote(action().text)}
    ><QuoteIcon /></IconButton>}</Show>
  </article>;
}
