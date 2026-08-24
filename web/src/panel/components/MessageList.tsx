// 消息区：权限条 + 消息列表（自动吸底滚动）。
//
// 由 ChatView 拆出（中间区三块之一）；气泡内 reasoning 在前、正文在后，
// loading feedback uses the shared LoadingState primitive.
//
// F4（ui.md §四.6 / §3.8）：滚动区为 flex-1 + min-h-0 独立滚动，内部为
// 居中正文列（max-w 820px，pt-6 / pb-6，底部 156px 留白随 F7 Composer
// 悬浮再调）；PermissionBar 位于正文列顶部 sticky（top 12px）；消息按
// role/状态呈现八类视觉。消息模型、顺序、Yjs 读取、自动吸底算法与
// permission decision 值（allow/deny、按钮顺序）均不变。

import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { chatEntries, chatHead, elicitations, permissions, resolvePermission, retryMessageSubmission, retryPersistentAction, runtimeDocsHydrated, selectedCid } from '../store';
import { readOnly } from '../lib/auth-state';
import { messageActivity, nextFollowState } from '../lib/message-follow.ts';
import { messageTime } from '../lib/message-time.ts';
import type { ChatEntry } from '../lib/chat-view';
import { Button, EmptyState, LoadingState } from '../../components/ui';
import { PermissionQueue } from './PermissionQueue';
import { ConversationMessage } from './ConversationMessage';
import { permissionDecisions } from '../lib/permission-delivery';
import { acknowledgeUnknownMessageDelivery, acknowledgedMessageDeliveries, canAcknowledgeUnknownMessageDelivery, dismissFailedMessageDelivery, messageSubmission } from '../lib/message-delivery';
import { MessageOutbox } from './MessageOutbox';
import { replayBoundaryAt, type ReplayBoundary } from '../lib/replay-boundary';


// ── 权限条 ──────────────────────────────────────────────────────────────

// 位于正文列顶部 sticky（§3.8）：warning-soft 背景、1px 淡化 warning 边框、
// 16px 圆角；「允许」深灰实心、「拒绝」outline/ghost，避免把安全决策设计
// 成绿色诱导操作；不加阴影（§3.5 阴影只用于真正浮起的层级）。
function PermissionBar() {
  return <PermissionQueue
    permissions={permissions()}
    decisions={permissionDecisions()}
    readOnly={readOnly()}
    onResolve={resolvePermission}
    onRetry={retryPersistentAction}
  />;
}

function HistoryBoundary(props: { kind: Exclude<ReplayBoundary, null> }) {
  const label = () => props.kind === 'live_runtime' ? 'Current' : 'Recovered';
  const accessibleLabel = () => props.kind === 'live_runtime'
    ? 'Current run'
    : props.kind === 'verified_history'
      ? 'Peri-verified recovered history'
      : 'Recovered history';
  const detail = () => props.kind === 'inferred_history'
    ? 'Identified from the session load window; some sources are marked unverifiable'
    : null;
  return <div class="history-boundary grid grid-cols-boundary items-center gap-8 mt-14 mb-10 text-text-muted text-10 tracking-25 text-center before:h-px before:bg-divider before:content-[''] after:h-px after:bg-divider after:content-['']" role="separator" aria-label={accessibleLabel()} title={detail() || accessibleLabel()}>
    <span class="whitespace-nowrap">{label()}</span>
  </div>;
}

function ChatLoading() {
  return <span class="chat-loading message-loading sr-only" role="status" aria-live="polite">Agent working</span>;
}

// ── 消息滚动区 ──────────────────────────────────────────────────────────

export function MessageList(props: { bottomInset?: number }) {
  const [stick, setStick] = createSignal(true);
  const [hasNewContent, setHasNewContent] = createSignal(false);
  const [completionAnnouncement, setCompletionAnnouncement] = createSignal('');
  let areaRef: HTMLDivElement | undefined;
  let previousActivity = '';
  let completionBaselineReady = false;
  let announcementChatId: string | null | undefined;
  let announcedCompletionKey: string | null = null;
  const outboxForChat = () => {
    const submission = messageSubmission();
    return submission?.chatId === selectedCid() && !submission.projected ? submission : null;
  };
  const acknowledgedForChat = () => acknowledgedMessageDeliveries()
    .filter((submission) => submission.chatId === selectedCid());

  // Composer 绝对覆盖在滚动区上方：动态高度 + 最小安全留白，保证最后一条消息不被贴住或遮挡。
  const contentBottomInset = () => `${Math.max(props.bottomInset ?? 0, 64) + 40}px`;
  const jumpBottomInset = () => `${Math.max(props.bottomInset ?? 0, 0) + 12}px`;

  // 稳定槽位与按 id 索引（见下方 <For> 注释：等效显式 itemKey）。
  // id 字符串序列供外层 <For> diff；Map 供稳定槽位读取最新投影。
  const chatEntryIds = createMemo(() => chatEntries().map((entry) => entry.id));
  const chatEntriesById = createMemo(() => {
    const byId = new Map<string, ChatEntry>();
    for (const entry of chatEntries()) byId.set(entry.id, entry);
    return byId;
  });

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    if (!areaRef) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    areaRef.scrollTo({ top: areaRef.scrollHeight, behavior: reducedMotion ? 'auto' : behavior });
  };

  // 自动吸底（用户上滚时暂停）——算法与阈值（40px）保持不变
  createEffect(() => {
    const list = chatEntries();
    const outbox = outboxForChat();
    const outboxActivity = outbox ? `${outbox.commandId}:${outbox.phase}` : '';
    const activity = `${messageActivity(list)}|${outboxActivity}`;
    const follow = nextFollowState({ stick: stick(), hasNewContent: hasNewContent(), previousActivity, activity });
    if (follow.stick && areaRef && (list.length || outbox)) {
      scrollToBottom();
    }
    setHasNewContent(follow.hasNewContent);
    previousActivity = follow.activity;
  });

  const latestCompletion = () => [...chatEntries()].reverse().find((item) => item.role === 'assistant' && ['completed', 'failed', 'cancelled', 'interrupted'].includes(item.status || ''));

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
      }}
      class="ui-scrollbar message-list-scroll min-h-0 flex-1 overflow-y-auto"
    >
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{completionAnnouncement()}</div>
      {/* Composer 覆盖在时间线底部；动态 inset 让最后一条消息始终完整可读。 */}
      <div class="message-list-content box-border w-full max-w-(--container-chat) mx-auto pt-32 px-20 desk:max-wide:max-w-(--container-chat-narrow) desk:max-wide:px-18 max-desk:max-w-(--container-chat-narrow) max-narrow:px-10" style={{ 'padding-bottom': contentBottomInset() }}>
        <PermissionBar />
        <Show when={!runtimeDocsHydrated()}>
          <LoadingState label="Loading session" class="min-h-(--container-placeholder-narrow) flex-col justify-center text-center" />
        </Show>
        <Show when={runtimeDocsHydrated() && chatEntries().length === 0 && !outboxForChat()}>
          <EmptyState title="Start this conversation" description="Send the first message. Content is saved to this session and can be restored later." class="min-h-(--container-placeholder)" />
        </Show>
        {/* 显式稳定 key（等效 itemKey）：Solid 1.9 的 <For> 没有 React 式 key
            prop，它按 item 引用做 diff；而 chatEntries() 每次 Yjs 投影都全量
            重建对象（store.ts:403 renderChat），任何单条更新都会让全部引用
            失配 → 整个列表 DOM 重挂载，滚动跟随与气泡内部状态随之丢失。
            ChatEntry.id 是 chat-view.ts 中 Yjs entries map 的稳定键，外层 <For>
            按 id 字符串序列渲染稳定槽位，条目 props 读取最新的同 ID 投影。 */}
        <For each={chatEntryIds()}>
          {(id, index) => (
            <>
              <Show when={replayBoundaryAt(chatEntries(), index())}>{(kind) => <HistoryBoundary kind={kind()} />}</Show>
              <ConversationMessage entry={() => chatEntriesById().get(id)!} />
            </>
          )}
        </For>
        <Show when={chatHead()?.chat?.loading}><ChatLoading /></Show>
        <For each={acknowledgedForChat()}>{(submission) =>
          <MessageOutbox submission={submission} acknowledged onRetry={() => {}} onEdit={() => {}} />
        }</For>
        <Show when={outboxForChat()}>{(submission) =>
          <MessageOutbox submission={submission()} onRetry={retryMessageSubmission} onEdit={dismissFailedMessageDelivery} acknowledgeDisabled={!canAcknowledgeUnknownMessageDelivery()} onAcknowledge={() => acknowledgeUnknownMessageDelivery(submission().commandId)} />
        }</Show>
      </div>
    </section>
    <Show when={(!stick() || hasNewContent()) && permissions().length === 0 && elicitations().length === 0}><Button type="button" size="compact" class="jump-latest absolute z-12 left-1/2 -translate-x-1/2 min-h-36 px-13 border border-border-subtle rounded-full bg-surface-translucent text-text-secondary shadow-popover cursor-pointer text-12 backdrop-blur-sm hover:text-text-primary pointer-coarse:min-h-44 pointer-coarse:px-16" style={{ bottom: jumpBottomInset() }} onClick={jumpToLatest}>{hasNewContent() ? '↓ New content' : '↓ Back to latest'}</Button></Show>
    </div>
  );
}
