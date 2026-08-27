// 消息区：消息列表（自动吸底滚动）。
//
// 由 ChatView 拆出（中间区三块之一）；气泡内 reasoning 在前、正文在后，
// loading feedback uses the shared LoadingState primitive.
//
// F4（ui.md §四.6 / §3.8）：滚动区为 flex-1 + min-h-0 独立滚动，内部为
// 居中正文列（max-w 820px，pt-6 / pb-6，底部 156px 留白随 F7 Composer
// 悬浮再调）；消息按 role/状态呈现八类视觉。消息模型、顺序、Yjs 读取、自动吸底算法与
// permission decision 值（allow/deny、按钮顺序）由 Composer 上方的决策槽位承载。

import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { chatEntries, chatHead, elicitations, permissions, retryMessageSubmission, runtimeDocsHydrated, selectedCid } from '../store';
import { nextFollowState } from '../lib/message-follow.ts';
import { messageTime } from '../lib/message-time.ts';
import type { ChatEntry } from '../lib/chat-view';
import { Button, EmptyState, LoadingState } from '../../components/ui';
import { ConversationMessage } from './ConversationMessage';
import { acknowledgeUnknownMessageDelivery, acknowledgedMessageDeliveries, canAcknowledgeUnknownMessageDelivery, dismissFailedMessageDelivery, messageSubmissionForChat } from '../lib/message-delivery';
import { MessageOutbox } from './MessageOutbox';
import { replayBoundaryAt, type ReplayBoundary } from '../lib/replay-boundary';
import { TranscriptWindow } from '../lib/transcript-window';
import { visibleElicitations } from '../lib/elicitation-delivery';


function HistoryBoundary(props: { kind: Exclude<ReplayBoundary, null> }) {
  const label = () => props.kind === 'live_runtime'
    ? 'Current'
    : props.kind === 'verified_history'
      ? 'Verified history'
      : 'Unverified history';
  const accessibleLabel = () => props.kind === 'live_runtime'
    ? 'Current run'
    : props.kind === 'verified_history'
      ? 'Peri-verified recovered history'
      : 'Unverified recovered history';
  const detail = () => props.kind === 'inferred_history'
    ? 'Identified from the session load window; some sources are marked unverifiable'
    : null;
  return <div class="history-boundary grid grid-cols-boundary items-center gap-8 mt-14 mb-10 text-text-muted text-10 tracking-25 text-center before:h-px before:bg-divider before:content-[''] after:h-px after:bg-divider after:content-['']" role="separator" aria-label={accessibleLabel()} title={detail() || accessibleLabel()}>
    <span class="whitespace-nowrap">{label()}</span>
  </div>;
}

function ChatLoading() {
  return <div class="chat-loading message-loading mb-12 flex min-h-32 items-center gap-8 text-12 text-text-muted" aria-hidden="true">
    <span class="grid size-18 shrink-0 place-items-center rounded-6 border border-border-subtle bg-surface-muted" aria-hidden="true">
      <i class="h-10 w-2 rounded-full bg-text-muted animate-pulse motion-reduce:animate-none" />
    </span>
    <span><strong class="font-650 text-text-primary">Peri</strong> is working</span>
  </div>;
}

function TranscriptRow(props: {
  id: string;
  position: number;
  size: number;
  onMeasure: (id: string, height: number) => void;
  children: JSX.Element;
}) {
  let row: HTMLDivElement | undefined;
  let observer: ResizeObserver | undefined;
  const measure = () => {
    const height = row?.getBoundingClientRect().height ?? 0;
    if (height > 0) props.onMeasure(props.id, height);
  };
  onMount(() => {
    measure();
    if (!row || typeof ResizeObserver === 'undefined') return;
    observer = new ResizeObserver(measure);
    observer.observe(row);
  });
  onCleanup(() => observer?.disconnect());
  return <div
    ref={row}
    class="transcript-row flow-root"
    role="listitem"
    aria-posinset={props.position}
    aria-setsize={props.size}
    data-transcript-id={props.id}
  >{props.children}</div>;
}

// ── 消息滚动区 ──────────────────────────────────────────────────────────

export function MessageList(props: { footerHeight?: number }) {
  const [stick, setStick] = createSignal(true);
  const [hasNewContent, setHasNewContent] = createSignal(false);
  const [completionAnnouncement, setCompletionAnnouncement] = createSignal('');
  let areaRef: HTMLDivElement | undefined;
  let transcriptRef: HTMLDivElement | undefined;
  let prefixRef: HTMLDivElement | undefined;
  let prefixObserver: ResizeObserver | undefined;
  let prefixHeight = 0;
  let mounted = true;
  let previousActivity = '';
  let previousEntryProjection: readonly ChatEntry[] | undefined;
  let entryProjectionRevision = 0;
  let transcriptChatId = selectedCid();
  let completionBaselineReady = false;
  let observedFooterHeight = props.footerHeight ?? 0;
  let announcementChatId: string | null | undefined;
  let announcedCompletionKey: string | null = null;
  const transcript = new TranscriptWindow({ estimatedHeight: 80, overscan: 320 });
  const [viewport, setViewport] = createSignal({ top: 0, height: 800 });
  const [windowRevision, setWindowRevision] = createSignal(0);
  const outboxForChat = () => {
    const submission = messageSubmissionForChat(selectedCid());
    return submission && !submission.projected ? submission : null;
  };
  const acknowledgedForChat = () => acknowledgedMessageDeliveries()
    .filter((submission) => submission.chatId === selectedCid());
  const activeTurnEntries = () => {
    const turnId = chatHead()?.activeTurn?.turnId || chatHead()?.chat?.activeTurnId;
    return turnId ? chatEntries().filter((item) => item.role === 'assistant' && item.turnId === turnId) : [];
  };
  const isNonterminalTool = (status: string | null) => ['pending', 'running', 'in_progress', 'awaiting_permission', 'awaitingPermission'].includes(status ?? '');
  const latestTurnActivity = () => {
    const entries = activeTurnEntries();
    // 并行工具可能分散在多个 assistant 分段；任何仍未终结的工具都优先拥有状态面。
    for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
      const entry = entries[entryIndex];
      const blockTools = entry.blocks.filter((block) => block.kind === 'tool_call').map((block) => block.toolCall);
      const tools = blockTools.length ? blockTools : entry.toolCalls;
      for (let toolIndex = tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
        if (isNonterminalTool(tools[toolIndex].status)) return { kind: 'tool', tool: tools[toolIndex] } as const;
      }
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const lastBlock = entry.blocks.at(-1);
      if (lastBlock?.kind === 'tool_call') return { kind: isNonterminalTool(lastBlock.toolCall.status) ? 'tool' : 'terminal_tool', tool: lastBlock.toolCall } as const;
      if (lastBlock) return { kind: 'content' } as const;

      // 旧投影没有块顺序；同一分段内运行工具优先，正文优先于已结束工具。
      const lastTool = entry.toolCalls.at(-1);
      if (lastTool && isNonterminalTool(lastTool.status)) return { kind: 'tool', tool: lastTool } as const;
      if (entry.text.trim() || entry.reasoning.length || entry.resources.length || entry.error) return { kind: 'content' } as const;
      if (lastTool) return { kind: 'terminal_tool', tool: lastTool } as const;
    }
    return null;
  };
  const agentActivityAnnouncement = createMemo(() => {
    if (!runtimeDocsHydrated() || !chatHead()?.chat?.loading) return '';
    if (permissions().some((permission) => permission.status === 'pending')) return 'Waiting for permission';
    if (visibleElicitations(elicitations()).length > 0) return 'Waiting for your answer';
    const activity = latestTurnActivity();
    if (activity?.kind === 'tool') return `${activity.tool.name?.trim() || 'Tool'} ${activity.tool.status === 'awaiting_permission' || activity.tool.status === 'awaitingPermission' ? 'waiting for permission' : 'running'}`;
    if (activity?.kind === 'content') return '';
    return 'Peri is working';
  });
  // 泛化 loading 只填补真正的 thinking gap；工具行和决策面板已经承担可见状态，不能重复。
  const showChatLoading = () => agentActivityAnnouncement() === 'Peri is working';

  // 底部状态区变高会压缩滚动视口。跟随最新消息时重新吸底；用户上滚时
  // 保持阅读位置，不让布局变化夺走控制权。
  createEffect(() => {
    const nextHeight = props.footerHeight ?? 0;
    if (nextHeight === observedFooterHeight) return;
    observedFooterHeight = nextHeight;
    if (!areaRef || !stick()) return;
    queueMicrotask(() => {
      if (mounted && stick()) scrollToBottom();
    });
  });

  // 稳定槽位与按 id 索引（见下方 <For> 注释：等效显式 itemKey）。
  // id 字符串序列供外层 <For> diff；Map 供稳定槽位读取最新投影。
  const chatEntryIds = createMemo(() => chatEntries().map((entry) => entry.id));
  const transcriptOffset = () => {
    if (!areaRef || !transcriptRef) return 0;
    const area = areaRef.getBoundingClientRect();
    const transcriptBounds = transcriptRef.getBoundingClientRect();
    if (area.width === 0 && area.height === 0 && transcriptBounds.width === 0 && transcriptBounds.height === 0) return 0;
    return areaRef.scrollTop + transcriptBounds.top - area.top;
  };
  const transcriptScrollTop = (areaScrollTop = areaRef?.scrollTop ?? 0) => Math.max(0, areaScrollTop - transcriptOffset());
  const updateViewport = (areaScrollTop = areaRef?.scrollTop ?? 0) => {
    setViewport({ top: transcriptScrollTop(areaScrollTop), height: areaRef?.clientHeight || 800 });
  };
  createEffect(() => {
    const ids = chatEntryIds();
    const chatId = selectedCid();
    const chatChanged = chatId !== transcriptChatId;
    transcriptChatId = chatId;
    const anchor = areaRef && !stick() && !chatChanged ? transcript.captureAnchor(transcriptScrollTop()) : null;
    const itemsChanged = transcript.setItems(ids);
    if (chatChanged) {
      setStick(true);
      setHasNewContent(false);
      setViewport({ top: Number.MAX_SAFE_INTEGER, height: areaRef?.clientHeight || 800 });
      queueMicrotask(() => {
        if (mounted && selectedCid() === chatId) scrollToBottom();
      });
    }
    if (!itemsChanged) return;
    const restored = transcript.restoreAnchor(anchor);
    if (areaRef && restored !== null) {
      areaRef.scrollTop = transcriptOffset() + restored;
      updateViewport();
    }
    setWindowRevision((value) => value + 1);
  });
  const visibleTranscript = createMemo(() => {
    windowRevision();
    const current = viewport();
    return transcript.slice(current.top, current.height);
  });

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    if (!areaRef) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const top = Math.max(0, areaRef.scrollHeight - areaRef.clientHeight);
    updateViewport(top);
    areaRef.scrollTo({ top: areaRef.scrollHeight, behavior: reducedMotion ? 'auto' : behavior });
  };

  const measureTranscriptRow = (id: string, height: number) => {
    const anchor = areaRef && !stick() ? transcript.captureAnchor(transcriptScrollTop()) : null;
    if (!transcript.measure(id, height)) return;
    if (areaRef && stick()) {
      scrollToBottom();
    } else {
      const restored = transcript.restoreAnchor(anchor);
      if (areaRef && restored !== null) {
        areaRef.scrollTop = transcriptOffset() + restored;
        updateViewport();
      }
    }
    setWindowRevision((value) => value + 1);
  };

  onMount(() => {
    if (!prefixRef || typeof ResizeObserver === 'undefined') return;
    prefixObserver = new ResizeObserver((entries) => {
      const nextHeight = entries[0]?.contentRect.height ?? 0;
      const delta = prefixHeight > 0 ? nextHeight - prefixHeight : 0;
      prefixHeight = nextHeight;
      if (!areaRef || delta === 0) return;
      if (stick()) scrollToBottom();
      else {
        areaRef.scrollTop += delta;
        updateViewport();
      }
    });
    prefixObserver.observe(prefixRef);
  });
  onCleanup(() => {
    mounted = false;
    prefixObserver?.disconnect();
  });

  // 自动吸底（用户上滚时暂停）——算法与阈值（40px）保持不变
  createEffect(() => {
    const list = chatEntries();
    if (list !== previousEntryProjection) {
      previousEntryProjection = list;
      entryProjectionRevision += 1;
    }
    const outbox = outboxForChat();
    const outboxActivity = outbox ? `${outbox.commandId}:${outbox.phase}` : '';
    const activity = `${entryProjectionRevision}|${outboxActivity}`;
    const follow = nextFollowState({ stick: stick(), hasNewContent: hasNewContent(), previousActivity, activity });
    if (follow.stick && areaRef && (list.length || outbox)) {
      scrollToBottom();
    }
    setHasNewContent(follow.hasNewContent);
    previousActivity = follow.activity;
  });

  const latestCompletion = () => {
    const list = chatEntries();
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const item = list[index];
      if (item.role === 'assistant' && ['completed', 'failed', 'cancelled', 'interrupted'].includes(item.status || '')) return item;
    }
    return undefined;
  };

  createEffect(() => {
    const chatId = selectedCid() ?? null;
    const completion = latestCompletion();
    const completionKey = completion ? `${completion.id}:${completion.status}:${completion.completedAt ?? ''}` : null;
    if (chatId !== announcementChatId) {
      announcementChatId = chatId;
      announcedCompletionKey = null;
      completionBaselineReady = false;
      setCompletionAnnouncement('');
    }
    if (!runtimeDocsHydrated()) return;
    if (!completionBaselineReady) {
      announcedCompletionKey = completionKey;
      completionBaselineReady = true;
      return;
    }
    if (!completion || completionKey === announcedCompletionKey) return;
    announcedCompletionKey = completionKey;
    const status = completion.status === 'completed' ? 'completed' : completion.status === 'failed' ? 'failed' : completion.status === 'cancelled' ? 'cancelled' : 'interrupted';
    const timestamp = messageTime(completion.createdAt);
    setCompletionAnnouncement(`Assistant response ${status}${timestamp ? `, ${timestamp.label}` : ''}`);
  });

  const jumpToLatest = () => {
    if (!areaRef) return;
    scrollToBottom('smooth');
    setStick(true);
    setHasNewContent(false);
  };

  return (
    <div class="message-list-shell relative flex min-h-0 flex-1 overflow-hidden">
    <section aria-label="Conversation messages"
      ref={areaRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        updateViewport(el.scrollTop);
      }}
      class="ui-scrollbar message-list-scroll min-h-0 flex-1 overflow-y-auto [overflow-anchor:none] [overscroll-behavior:contain] [scrollbar-gutter:stable]"
    >
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{completionAnnouncement()}</div>
      <div class="sr-only" role="status" aria-label="Agent activity" aria-live="polite" aria-atomic="true">{agentActivityAnnouncement()}</div>
      <div class="message-list-content box-border w-full max-w-(--container-chat-content) mx-auto px-20 pt-32 pb-32 desk:max-wide:px-18 max-narrow:px-10">
        <div ref={prefixRef} class="transcript-prefix">
          <Show when={!runtimeDocsHydrated()}>
            <LoadingState label="Loading session" class="min-h-(--container-placeholder-narrow) flex-col justify-center text-center" />
          </Show>
          <Show when={runtimeDocsHydrated() && chatEntries().length === 0 && !outboxForChat()}>
            <EmptyState title="Start this conversation" description="Send the first message. Content is saved to this session and can be restored later." class="min-h-(--container-placeholder)" />
          </Show>
        </div>
        <div ref={transcriptRef} class="transcript-window" role="list" aria-label="Conversation transcript">
          <div class="transcript-spacer" aria-hidden="true" style={{ height: `${visibleTranscript().beforeHeight}px` }} />
          <For each={visibleTranscript().ids}>
            {(id, localIndex) => {
              const globalIndex = () => visibleTranscript().start + localIndex();
              return <TranscriptRow id={id} position={globalIndex() + 1} size={chatEntryIds().length} onMeasure={measureTranscriptRow}>
                <Show when={replayBoundaryAt(chatEntries(), globalIndex())}>{(kind) => <HistoryBoundary kind={kind()} />}</Show>
                <Show when={chatEntries()[globalIndex()]}>{(entry) => <ConversationMessage entry={entry} />}</Show>
              </TranscriptRow>;
            }}
          </For>
          <div class="transcript-spacer" aria-hidden="true" style={{ height: `${visibleTranscript().afterHeight}px` }} />
        </div>
        <Show when={showChatLoading()}><ChatLoading /></Show>
        <For each={acknowledgedForChat()}>{(submission) =>
          <MessageOutbox submission={submission} acknowledged onRetry={() => {}} onEdit={() => {}} />
        }</For>
        <Show when={outboxForChat()}>{(submission) =>
          <MessageOutbox submission={submission()} onRetry={retryMessageSubmission} onEdit={() => dismissFailedMessageDelivery(submission().commandId)} acknowledgeDisabled={!canAcknowledgeUnknownMessageDelivery(submission().commandId)} onAcknowledge={() => acknowledgeUnknownMessageDelivery(submission().commandId)} />
        }</Show>
      </div>
    </section>
    <Show when={(!stick() || hasNewContent()) && permissions().length === 0 && visibleElicitations(elicitations()).length === 0}><Button type="button" size="compact" class="jump-latest absolute bottom-12 z-12 left-1/2 -translate-x-1/2 min-h-36 px-13 border border-border-subtle rounded-full bg-surface-translucent text-text-secondary shadow-popover cursor-pointer text-12 backdrop-blur-sm hover:text-text-primary pointer-coarse:min-h-44 pointer-coarse:px-16" onClick={jumpToLatest}>{hasNewContent() ? '↓ New content' : '↓ Back to latest'}</Button></Show>
    </div>
  );
}
