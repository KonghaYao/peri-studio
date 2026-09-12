import { createEffect, createMemo, createSignal, For, Show, type Accessor } from 'solid-js';
import type { ChatBlock, ChatEntry } from '@/entities/chat/chat-view';
import {
  buildAssistantLayoutUnits,
  buildConversationRowGroups,
  layoutUnitActivityDensity,
  shouldRenderActivityReasoningBlock,
  type ActivityBoundary,
  type AssistantLayoutUnit,
} from '@/features/chat/chat-render-blocks';
import { messageTime } from '@/shared/lib/message-time';
import {
  Bubble,
  BubbleContent,
  CopyButton,
  IconButton,
  InlineNotice,
  MessageArticleShell,
  MessageAssistantActionsShell,
  MessageMetaHeader,
  MessageSurfaceShell,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  ResourceCite,
  ToolActivityGroup,
  UserBubble,
} from '@peri/ui';
import { MessageSquareQuote } from 'lucide-solid';
import { splitSystemReminders } from '@/shared/lib/system-reminder';
import { chatCatalog, selectedCid } from '@/store';
import { Markdown } from './Markdown';
import { ToolCallActivity } from './ToolCallActivity';
import { McpAppFrame } from './McpAppFrame';
import { isPrimaryLiveMcpApp, maybeOpenCompletedMcpTool } from '@/features/mcp/mcp-apps';
import { requestComposerQuote } from '@/features/composer/composer-quote';

import type { ToolCallInfo } from '@/entities/chat/chat-view';

/** Solid `<For>` 在本项目测试运行时传入的是字符串而非 accessor，统一解包。 */
function readForItem<T>(item: T | (() => T)): T {
  return typeof item === 'function' ? (item as () => T)() : item;
}

function McpToolBlock(props: {
  toolCall: Accessor<ToolCallInfo>;
  origin: Accessor<'live' | 'replay' | null>;
  siblingTools: Accessor<ToolCallInfo[]>;
  duplicate: boolean;
  variant?: 'default' | 'activity';
  projectCwd: Accessor<string | null>;
}) {
  createEffect(() => {
    if (props.duplicate) return;
    maybeOpenCompletedMcpTool(props.toolCall(), props.origin());
  });
  const toolCallId = () => props.toolCall().toolCallId || '';
  return (
    <Show when={!props.duplicate}>
      <Show when={isPrimaryLiveMcpApp(toolCallId(), props.siblingTools())} fallback={<ToolCallActivity toolCall={props.toolCall} variant={props.variant} projectCwd={props.projectCwd()} />}>
        <McpAppFrame toolCallId={toolCallId()} />
      </Show>
    </Show>
  );
}

type ChatEntrySource = ChatEntry | Accessor<ChatEntry>;

function MessageBlock(props: {
  block: () => ChatBlock;
  blockIndex: () => number;
  role: () => 'user' | 'assistant' | 'system';
  streaming: () => boolean;
  entry: () => ChatEntry;
  toolCallsInBlocks: () => ToolCallInfo[];
  blockIds: () => string[];
  blocksById: () => Map<string, ChatBlock>;
  activityBoundary: () => ActivityBoundary;
  reasoningVariant?: 'default' | 'activity';
  toolVariant?: 'default' | 'activity';
  projectCwd: Accessor<string | null>;
}) {
  const toolCall = () => {
    const current = props.block();
    return current.kind === 'tool_call' ? current.toolCall : null;
  };
  const duplicateToolBlock = () => {
    const id = toolCall()?.toolCallId || '';
    if (!id) return false;
    const ids = props.blockIds();
    const byId = props.blocksById();
    for (let index = 0; index < props.blockIndex(); index += 1) {
      const previous = byId.get(ids[index]);
      if (previous?.kind === 'tool_call' && (previous.toolCall.toolCallId || '') === id) return true;
    }
    return false;
  };

  return <Show when={props.block().kind === 'reasoning'} fallback={
    <Show when={props.block().kind === 'text'} fallback={
      <Show when={props.block().kind === 'tool_call'} fallback={
        <ResourceCite
          name={(props.block() as Extract<ChatBlock, { kind: 'resource' }>).resource.name || (props.block() as Extract<ChatBlock, { kind: 'resource' }>).resource.resourceId || 'Resource'}
          mediaType={(props.block() as Extract<ChatBlock, { kind: 'resource' }>).resource.mediaType || undefined}
          resourceId={(props.block() as Extract<ChatBlock, { kind: 'resource' }>).resource.resourceId || undefined}
        />
      }><McpToolBlock
        toolCall={() => toolCall()!}
        origin={() => (props.entry().origin === 'session_replay' ? 'replay' as const : props.entry().origin === 'live' ? 'live' as const : null)}
        siblingTools={props.toolCallsInBlocks}
        duplicate={duplicateToolBlock()}
        variant={props.toolVariant}
        projectCwd={props.projectCwd}
      /></Show>
    }>{
      <Bubble variant="ghost" align="start" class="w-full" data-testid="conversation-message-text">
        <BubbleContent>
          <Show when={props.role() === 'assistant'} fallback={<For each={splitSystemReminders((props.block() as Extract<ChatBlock, { kind: 'text' }>).text)}>{(segment) =>
            <Show when={segment.kind === 'text'}>
              <span class="whitespace-pre-wrap wrap-anywhere">{segment.text}</span>
            </Show>
          }</For>}>
            <Markdown
              source={() => (props.block() as Extract<ChatBlock, { kind: 'text' }>).text}
              streaming={props.streaming()}
            />
          </Show>
        </BubbleContent>
      </Bubble>
    }</Show>
  }>{(() => {
    const reasoning = () => (props.block() as Extract<ChatBlock, { kind: 'reasoning' }>).reasoning;
    const reasoningStreaming = () => {
      if (!props.streaming()) return false;
      const text = reasoning().text;
      if (props.reasoningVariant === 'activity' && !text.trim()) return true;
      return props.blockIndex() === props.blockIds().length - 1;
    };
    const orderedBlocks = () => props.blockIds().map((id) => props.blocksById().get(id)!);
    const showReasoning = () => shouldRenderActivityReasoningBlock(
      orderedBlocks(),
      props.blockIndex(),
      props.streaming(),
      props.activityBoundary(),
    );
    return (
      <Show when={showReasoning()}>
        <Reasoning
          appearance="transcript"
          variant={props.reasoningVariant}
          isStreaming={reasoningStreaming()}
          text={reasoning().text}
        >
          <ReasoningTrigger />
          <ReasoningContent>{reasoning().text}</ReasoningContent>
        </Reasoning>
      </Show>
    );
  })()}</Show>;
}

function QuoteIcon() {
  return <MessageSquareQuote size={16} strokeWidth={1.7} />;
}

function SystemReminderBadge(props: { reminders: string[] }) {
  return <Popover placement="bottom-start">
    <PopoverTrigger type="button" class="self-start inline-flex h-20 cursor-pointer items-center rounded-6 border-0 bg-surface-sunken px-8 text-11 font-medium text-content-secondary hover:bg-interaction-hover pointer-coarse:min-h-44" aria-label="System message">
      System
    </PopoverTrigger>
    <PopoverContent class="max-h-(--container-system-reminder-tall) w-(--container-system-reminder) overflow-auto" aria-label="System message" data-testid="system-reminder-popover">
      <For each={props.reminders}>{(reminder, index) =>
        <p class={`${index() === 0 ? 'm-0' : 'm-0 mt-10'} whitespace-pre-wrap wrap-anywhere text-12 leading-19 text-content-secondary`}>{reminder}</p>
      }</For>
    </PopoverContent>
  </Popover>;
}

function AssistantLayoutUnitView(props: {
  unitId: () => string;
  unitsById: () => Map<string, AssistantLayoutUnit>;
  blocks: () => ChatBlock[];
  blocksById: () => Map<string, ChatBlock>;
  blockIds: () => string[];
  role: () => 'user' | 'assistant' | 'system';
  streaming: () => boolean;
  entry: () => ChatEntry;
  toolCallsInBlocks: () => ToolCallInfo[];
  activityBoundary: () => ActivityBoundary;
  projectCwd: Accessor<string | null>;
}) {
  const unit = () => props.unitsById().get(props.unitId())!;
  const activityVariant = () => {
    const current = unit();
    if (layoutUnitActivityDensity(props.blocks(), current, props.activityBoundary()) !== 'activity') return 'default' as const;
    return 'activity' as const;
  };
  const blockUnit = () => unit() as Extract<AssistantLayoutUnit, { kind: 'block' }>;
  const block = () => props.blocksById().get(blockUnit().blockId)!;
  const blockIndex = () => Math.max(0, props.blockIds().indexOf(blockUnit().blockId));

  return (
    <Show
      when={unit().kind === 'tool_group'}
      fallback={(
        <MessageBlock
          block={block}
          blockIndex={blockIndex}
          role={props.role}
          streaming={props.streaming}
          entry={props.entry}
          toolCallsInBlocks={props.toolCallsInBlocks}
          blockIds={props.blockIds}
          blocksById={props.blocksById}
          activityBoundary={props.activityBoundary}
          reasoningVariant={activityVariant()}
          toolVariant={activityVariant()}
          projectCwd={props.projectCwd}
        />
      )}
    >
      <ToolActivityGroup variant="activity" showRail={false}>
        <For each={(unit() as Extract<AssistantLayoutUnit, { kind: 'tool_group' }>).blockIds}>{(toolBlockIdItem) => {
          const toolId = () => readForItem(toolBlockIdItem);
          const toolBlock = () => props.blocksById().get(toolId())! as Extract<ChatBlock, { kind: 'tool_call' }>;
          const toolIndex = () => Math.max(0, props.blockIds().indexOf(toolId()));
          const toolCall = () => toolBlock().toolCall;
          const duplicateToolBlock = () => {
            const duplicateId = toolCall().toolCallId || '';
            if (!duplicateId) return false;
            const ids = props.blockIds();
            const byId = props.blocksById();
            for (let index = 0; index < toolIndex(); index += 1) {
              const previous = byId.get(ids[index]);
              if (previous?.kind === 'tool_call' && (previous.toolCall.toolCallId || '') === duplicateId) return true;
            }
            return false;
          };
          return (
            <McpToolBlock
              toolCall={toolCall}
              origin={() => (props.entry().origin === 'session_replay' ? 'replay' as const : props.entry().origin === 'live' ? 'live' as const : null)}
              siblingTools={props.toolCallsInBlocks}
              duplicate={duplicateToolBlock()}
              variant="activity"
              projectCwd={props.projectCwd}
            />
          );
        }}</For>
      </ToolActivityGroup>
    </Show>
  );
}

/** Owns the visual and semantic hierarchy of one server-projected entry. */
export function ConversationMessage(props: {
  entry: ChatEntrySource;
  activityBoundary?: Accessor<ActivityBoundary>;
  activityContinuation?: Accessor<{ before: boolean; after: boolean }>;
  terminalNoticeOwner?: Accessor<boolean>;
}) {
  let articleRef: HTMLElement | undefined;
  const [selectionAction, setSelectionAction] = createSignal<{ text: string; left: number; top: number } | null>(null);
  const [actionsOpen, setActionsOpen] = createSignal(false);
  const entry = () => typeof props.entry === 'function' ? props.entry() : props.entry;
  const projectCwd = createMemo(() => {
    const cid = selectedCid();
    if (!cid) return null;
    return chatCatalog().find((chat) => chat.id === cid)?.cwd ?? null;
  });
  const legacyBlocks = (): ChatBlock[] => [
    ...entry().reasoning.map((reasoning, index) => ({ kind: 'reasoning' as const, id: reasoning.id || `${entry().id}:reasoning:${index}`, reasoning })),
    ...entry().toolCalls.map((toolCall, index) => ({ kind: 'tool_call' as const, id: toolCall.toolCallId || `${entry().id}:tool:${index}`, toolCall })),
    ...(entry().text ? [{ kind: 'text' as const, id: `${entry().id}:text`, text: entry().text }] : []),
    ...entry().resources.map((resource, index) => ({ kind: 'resource' as const, id: resource.resourceId || `${entry().id}:resource:${index}`, resource })),
  ];
  // 旧快照与开发 fixture 可能尚无 blocks；只在该兼容边界回退到旧分组模型。
  const blocks = createMemo(() => entry().blocks?.length ? entry().blocks : legacyBlocks());
  const toolCallsInBlocks = createMemo(() => blocks().flatMap((block) => block.kind === 'tool_call' ? [block.toolCall] : []));
  const role = createMemo(() => entry().role === 'user' ? 'user' : entry().role === 'system' ? 'system' : 'assistant');
  const blockIds = createMemo(() => blocks().map((block) => block.id));
  const blocksById = createMemo(() => new Map(blocks().map((block) => [block.id, block])));
  const activityBoundary = () => props.activityBoundary?.() ?? { previousTool: false, nextTool: false };
  const terminalNoticeOwner = () => props.terminalNoticeOwner?.() ?? true;
  const layoutUnits = createMemo(() => buildAssistantLayoutUnits(blocks(), activityBoundary()));
  const layoutUnitsById = createMemo(() => new Map(layoutUnits().map((unit) => [unit.id, unit])));
  const rowGroups = createMemo(() => buildConversationRowGroups(blocks(), activityBoundary()));
  const rowGroupIds = createMemo(() => rowGroups().map((group) => group.id));
  const rowGroupsById = createMemo(() => new Map(rowGroups().map((group) => [group.id, group])));
  const systemReminders = createMemo(() => blocks().flatMap((block) => block.kind === 'text'
    ? splitSystemReminders(block.text).flatMap((segment) => segment.kind === 'system_reminder' ? [segment.text] : [])
    : []));
  const unknownDeliveryVisible = createMemo(() => entry().deliveryState === 'delivery_unknown');
  const userHasVisibleSurface = createMemo(() => role() !== 'user'
    || Boolean(entry().error || unknownDeliveryVisible() || entry().deliveryState === 'failed_not_delivered')
    || blocks().some((block) => block.kind !== 'text'
      || splitSystemReminders(block.text).some((segment) => segment.kind === 'text' && segment.text.trim().length > 0)));
  // Replay timestamps are Hub observation time, not original message time.
  const timestamp = createMemo(() => entry().origin === 'session_replay' ? null : messageTime(entry().createdAt));
  const streaming = () => entry().status === 'streaming';
  const actionsId = () => `message-actions-${entry().id}`;
  const label = () => role() === 'user' ? 'Your message' : role() === 'system' ? 'System message' : 'Assistant message';
  const partialTerminal = createMemo(() => {
    if (role() !== 'assistant' || !(entry().text || entry().reasoning.length || entry().toolCalls.length || entry().resources.length)) return null;
    const status = String(entry().status || '').toLowerCase();
    if (status === 'failed' || status === 'error') return { label: 'Response failed', state: 'failed', tone: 'danger' as const };
    if (status === 'interrupted') return { label: 'Response interrupted', state: 'interrupted', tone: 'warning' as const };
    if (status === 'cancelled' || status === 'canceled') return { label: 'Response cancelled', state: 'cancelled', tone: 'warning' as const };
    return null;
  });
  const copyText = () => partialTerminal()
    ? `${entry().text}\n\n[Partial response: ${partialTerminal()!.state}]`
    : entry().text;
  const terminalNotice = createMemo(() => terminalNoticeOwner() ? partialTerminal() : null);
  const visibleEntryError = createMemo(() => terminalNoticeOwner() ? entry().error : null);
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

  return <MessageArticleShell
    ref={articleRef}
    from={role()}
    aria-label={label()}
    onMouseUp={captureSelection}
    onKeyUp={captureSelection}
    onFocusOut={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActionsOpen(false);
    }}
  >
    <Show when={userHasVisibleSurface()}>
      <Show when={role() === 'user'} fallback={
        <MessageSurfaceShell from={role() === 'system' ? 'system' : 'assistant'}>
          <For each={rowGroupIds()}>{(groupIdItem) => {
            const rowGroupId = () => readForItem(groupIdItem);
            const rowGroup = () => rowGroupsById().get(rowGroupId())!;
            const unitViewProps = {
              unitsById: layoutUnitsById,
              blocks,
              blocksById,
              blockIds,
              role,
              streaming,
              entry,
              toolCallsInBlocks,
              activityBoundary,
              projectCwd,
            };
            return (
              <Show
                when={rowGroup().kind === 'activity'}
                fallback={
                  <For each={rowGroup().unitIds}>{(unitIdItem) =>
                    <AssistantLayoutUnitView unitId={() => readForItem(unitIdItem)} {...unitViewProps} />
                  }</For>
                }
              >
                <div data-testid="chat-activity-chain">
                  <For each={rowGroup().unitIds}>{(unitIdItem) =>
                    <AssistantLayoutUnitView unitId={() => readForItem(unitIdItem)} {...unitViewProps} />
                  }</For>
                </div>
              </Show>
            );
          }}</For>
          <Show when={terminalNotice()}>{(terminal) => <InlineNotice tone={terminal().tone} role="status" title="Partial response">
            <span>{terminal().label}. The output above may be incomplete.</span>
          </InlineNotice>}</Show>
          <Show when={visibleEntryError()}>{(error) => <InlineNotice tone="danger" role="alert" aria-label="Message error"><code class="whitespace-pre-wrap wrap-anywhere font-mono text-12 leading-normal">{error().code || 'UNKNOWN'}{error().message ? `: ${error().message}` : ''}</code></InlineNotice>}</Show>
          <Show when={role() === 'assistant' && entry().text && !streaming()}>
            <MessageAssistantActionsShell
              open={actionsOpen()}
              actionsId={actionsId()}
              onToggleOpen={() => setActionsOpen((open) => !open)}
            >
              <CopyButton text={copyText()} label="Copy answer" class="border-0 bg-transparent text-content-muted hover:bg-interaction-hover pointer-coarse:min-h-44" />
              <IconButton label="Quote answer" size="sm" variant="ghost" class="border-0 bg-transparent text-content-muted hover:bg-interaction-hover pointer-coarse:min-h-44 pointer-coarse:min-w-44" onClick={() => addQuote(copyText())}><QuoteIcon /></IconButton>
              <span class="ml-4 text-11 font-medium text-content-muted">Peri</span>
              <Show when={timestamp()}>{(time) => <time class="text-11 text-content-faint" dateTime={entry().createdAt} title={time().exact}>{time().label}</time>}</Show>
            </MessageAssistantActionsShell>
          </Show>
        </MessageSurfaceShell>
      }>
        <MessageMetaHeader>
          <Show when={timestamp()}>{(time) => <time dateTime={entry().createdAt} title={time().exact}>{time().label}</time>}</Show>
        </MessageMetaHeader>
        <UserBubble>
          <For each={blockIds()}>{(id) => {
            const block = () => blocksById().get(id)!;
            return <Show when={block().kind === 'text'}>
              <For each={splitSystemReminders((block() as Extract<ChatBlock, { kind: 'text' }>).text)}>{(segment) =>
                <Show when={segment.kind === 'text'}>
                  <span class="whitespace-pre-wrap wrap-anywhere">{segment.text}</span>
                </Show>
              }</For>
            </Show>;
          }}</For>
        </UserBubble>
        <Show when={unknownDeliveryVisible()}>
          <InlineNotice tone="warning" role="alert" title="Delivery result unknown">
            <span>This message may have already run. To avoid duplicate actions, it is not resent automatically.</span>
          </InlineNotice>
        </Show>
        <Show when={entry().deliveryState === 'failed_not_delivered'}>
          <InlineNotice tone="warning" role="status" title="Message not delivered">
            <span>The server confirmed ACP did not run this message. Copy it and resend.</span>
          </InlineNotice>
        </Show>
      </Show>
    </Show>
    <Show when={role() === 'user' && systemReminders().length > 0}>
      <SystemReminderBadge reminders={systemReminders()} />
    </Show>
    <Show when={selectionAction()}>{(action) => <IconButton
      label="Add selection to conversation"
      variant="primary"
      class="fixed z-50 w-36 min-h-30 -translate-x-1/2 -translate-y-full rounded-md border-0 bg-accent-solid p-0 text-content-on-accent shadow-overlay"
      style={{ left: `${action().left}px`, top: `${action().top}px` }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => addQuote(action().text)}
    ><QuoteIcon /></IconButton>}</Show>
  </MessageArticleShell>;
}
