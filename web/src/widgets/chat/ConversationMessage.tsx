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
import { resolveHiddenToolBlocks } from '@/features/chat/tool-block-dedup';
import { messageTime } from '@/shared/lib/message-time';
import {
  Bubble,
  BubbleContent,
  ChatActivityChain,
  IconButton,
  InlineNotice,
  MessageArticleShell,
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
import { read, type MaybeAccessor } from '@/shared/lib/maybe-accessor';

import type { ToolCallInfo } from '@/entities/chat/chat-view';

function McpToolBlock(props: {
  toolCall: Accessor<ToolCallInfo>;
  origin: Accessor<'live' | 'replay' | null>;
  siblingTools: Accessor<ToolCallInfo[]>;
  duplicate: MaybeAccessor<boolean>;
  variant?: 'default' | 'activity';
  projectCwd: MaybeAccessor<string | null>;
}) {
  const duplicate = () => read(props.duplicate);
  createEffect(() => {
    if (duplicate()) return;
    maybeOpenCompletedMcpTool(props.toolCall(), props.origin());
  });
  const toolCallId = () => props.toolCall().toolCallId || '';
  return (
    <Show when={!duplicate()}>
      <Show when={isPrimaryLiveMcpApp(toolCallId(), props.siblingTools())} fallback={<ToolCallActivity toolCall={props.toolCall} variant={props.variant} projectCwd={props.projectCwd} />}>
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
  hiddenToolBlockIds?: Accessor<ReadonlySet<string>>;
}) {
  const toolCall = () => {
    const current = props.block();
    return current.kind === 'tool_call' ? current.toolCall : null;
  };
  const duplicateToolBlock = () => props.hiddenToolBlockIds?.().has(props.block().id) ?? false;

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
        duplicate={duplicateToolBlock}
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
      // 空活动轨 reasoning 若仍标成 streaming，会在已结束的工具行旁再画一层 thinking-gap。
      if (props.reasoningVariant === 'activity' && !text.trim()) return false;
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
  hiddenToolBlockIds?: Accessor<ReadonlySet<string>>;
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
          hiddenToolBlockIds={props.hiddenToolBlockIds}
        />
      )}
    >
      <ToolActivityGroup variant="activity" showRail={false}>
        <For each={(unit() as Extract<AssistantLayoutUnit, { kind: 'tool_group' }>).blockIds}>{(toolBlockIdItem) => {
          const toolId = () => read(toolBlockIdItem);
          const toolBlock = () => props.blocksById().get(toolId())! as Extract<ChatBlock, { kind: 'tool_call' }>;
          const toolCall = () => toolBlock().toolCall;
          const duplicateToolBlock = () => props.hiddenToolBlockIds?.().has(toolId()) ?? false;
          return (
            <McpToolBlock
              toolCall={toolCall}
              origin={() => (props.entry().origin === 'session_replay' ? 'replay' as const : props.entry().origin === 'live' ? 'live' as const : null)}
              siblingTools={props.toolCallsInBlocks}
              duplicate={duplicateToolBlock}
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
  hiddenToolBlockIds?: Accessor<ReadonlySet<string>>;
}) {
  let articleRef: HTMLElement | undefined;
  const [selectionAction, setSelectionAction] = createSignal<{ text: string; left: number; top: number } | null>(null);
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
  const activityContinuation = () => props.activityContinuation?.() ?? { before: false, after: false };
  const terminalNoticeOwner = () => props.terminalNoticeOwner?.() ?? true;
  const hiddenToolBlockIds = createMemo(() => {
    if (props.hiddenToolBlockIds) return props.hiddenToolBlockIds();
    return resolveHiddenToolBlocks([entry()]).get(entry().id) ?? new Set<string>();
  });
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
  const label = () => role() === 'user' ? 'Your message' : role() === 'system' ? 'System message' : 'Assistant message';
  const partialTerminal = createMemo(() => {
    if (role() !== 'assistant' || !(entry().text || entry().reasoning.length || entry().toolCalls.length || entry().resources.length)) return null;
    const status = String(entry().status || '').toLowerCase();
    if (status === 'failed' || status === 'error') return { label: 'Response failed', state: 'failed', tone: 'danger' as const };
    if (status === 'interrupted') return { label: 'Response interrupted', state: 'interrupted', tone: 'warning' as const };
    if (status === 'cancelled' || status === 'canceled') return { label: 'Response cancelled', state: 'cancelled', tone: 'warning' as const };
    return null;
  });
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
  >
    <Show when={userHasVisibleSurface()}>
      <Show when={role() === 'user'} fallback={
        <MessageSurfaceShell from={role() === 'system' ? 'system' : 'assistant'}>
          <For each={rowGroupIds()}>{(groupIdItem, groupIndex) => {
            const rowGroupId = () => read(groupIdItem);
            const rowGroup = () => rowGroupsById().get(rowGroupId())!;
            const continuesBefore = () => groupIndex() === 0 && activityContinuation().before;
            const continuesAfter = () => groupIndex() === rowGroupIds().length - 1 && activityContinuation().after;
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
              hiddenToolBlockIds,
            };
            return (
              <Show
                when={rowGroup().kind === 'activity'}
                fallback={
                  <For each={rowGroup().unitIds}>{(unitIdItem) =>
                    <AssistantLayoutUnitView unitId={() => read(unitIdItem)} {...unitViewProps} />
                  }</For>
                }
              >
                <ChatActivityChain
                  continuesBefore={continuesBefore()}
                  continuesAfter={continuesAfter()}
                >
                  <For each={rowGroup().unitIds}>{(unitIdItem) =>
                    <AssistantLayoutUnitView unitId={() => read(unitIdItem)} {...unitViewProps} />
                  }</For>
                </ChatActivityChain>
              </Show>
            );
          }}</For>
          <Show when={terminalNotice()}>{(terminal) => <InlineNotice tone={terminal().tone} role="status" title="Partial response">
            <span>{terminal().label}. The output above may be incomplete.</span>
          </InlineNotice>}</Show>
          <Show when={visibleEntryError()}>{(error) => <InlineNotice tone="danger" role="alert" aria-label="Message error"><code class="whitespace-pre-wrap wrap-anywhere font-mono text-12 leading-normal">{error().code || 'UNKNOWN'}{error().message ? `: ${error().message}` : ''}</code></InlineNotice>}</Show>
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
