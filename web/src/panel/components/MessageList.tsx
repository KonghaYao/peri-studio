// 消息区：权限条 + 消息列表（自动吸底滚动）。
//
// 由 ChatView 拆出（中间区三块之一）；气泡内 reasoning 在前、正文在后，
// loading 状态统一由 LoadingDots 组件承担。
//
// F4（ui.md §四.6 / §3.8）：滚动区为 flex-1 + min-h-0 独立滚动，内部为
// 居中正文列（max-w 820px，pt-6 / pb-6，底部 156px 留白随 F7 Composer
// 悬浮再调）；PermissionBar 位于正文列顶部 sticky（top 12px）；消息按
// role/状态呈现八类视觉。消息模型、顺序、Yjs 读取、自动吸底算法与
// permission decision 值（allow/deny、按钮顺序）均不变。

import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { chatEntries, elicitationResponses, elicitations, permissions, resolvePermission, respondElicitation, retryMessageSubmission, retryPersistentAction, runtimeDocsHydrated, selectedCid } from '../store';
import { readOnly } from '../lib/auth-state';
import { messageActivity, nextFollowState } from '../lib/message-follow.ts';
import { messageTime } from '../lib/message-time.ts';
import type { ChatEntry } from '../lib/chat-view';
import { Button } from '../../ui';
import { PermissionQueue } from './PermissionQueue';
import { ConversationMessage } from './ConversationMessage';
import { permissionDecisions } from '../lib/permission-delivery';
import { dismissFailedMessageDelivery, messageSubmission } from '../lib/message-delivery';
import { MessageOutbox } from './MessageOutbox';
import { replayBoundaryAt, type ReplayBoundary } from '../lib/replay-boundary';
import { ElicitationQueue } from './ElicitationQueue';


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
  const label = () => props.kind === 'live_runtime'
    ? 'Current run'
    : props.kind === 'verified_history'
      ? 'Peri-verified recovered history'
      : 'Recovered history';
  const detail = () => props.kind === 'inferred_history'
    ? 'Identified from the session load window; some sources are marked unverifiable'
    : null;
  return <div class="history-boundary grid grid-cols-boundary items-center gap-10 mt-26 mb-18 text-text-muted text-11 tracking-35 text-center" role="separator" aria-label={label()}>
    <span class="whitespace-nowrap">{label()}</span>
    <Show when={detail()}>{(text) => <small class="col-span-full -mt-5 text-text-muted text-11 tracking-normal">{text()}</small>}</Show>
  </div>;
}

// ── 消息滚动区 ──────────────────────────────────────────────────────────

export function MessageList() {
  const [stick, setStick] = createSignal(true);
  const [hasNewContent, setHasNewContent] = createSignal(false);
  let areaRef: HTMLDivElement | undefined;
  let previousActivity = '';
  let previousElicitationIds = '';
  const outboxForChat = () => {
    const submission = messageSubmission();
    return submission?.chatId === selectedCid() && !submission.projected ? submission : null;
  };

  // 稳定槽位与按 id 索引（见下方 <For> 注释：等效显式 itemKey）。
  // id 字符串序列供外层 <For> diff；Map 供内层 keyed <Show> 读取最新投影。
  const chatEntryIds = createMemo(() => chatEntries().map((entry) => entry.id));
  const chatEntriesById = createMemo(() => {
    const byId = new Map<string, ChatEntry>();
    for (const entry of chatEntries()) byId.set(entry.id, entry);
    return byId;
  });

  // 自动吸底（用户上滚时暂停）——算法与阈值（40px）保持不变
  createEffect(() => {
    const list = chatEntries();
    const outbox = outboxForChat();
    const outboxActivity = outbox ? `${outbox.commandId}:${outbox.phase}` : '';
    const activity = `${messageActivity(list)}|${outboxActivity}`;
    const follow = nextFollowState({ stick: stick(), hasNewContent: hasNewContent(), previousActivity, activity });
    if (follow.stick && areaRef && (list.length || outbox)) {
      areaRef.scrollTop = areaRef.scrollHeight;
    }
    setHasNewContent(follow.hasNewContent);
    previousActivity = follow.activity;
  });

  // Agent-initiated questions are actionable control flow, not historical
  // prose. When a new form appears (including after restoring a session),
  // reveal it without stealing keyboard focus. The stable id snapshot prevents
  // answer edits and unrelated Yjs updates from repeatedly moving the reader.
  createEffect(() => {
    const ids = elicitations().map((item) => item.elicitationId).join('\u0000');
    if (!ids || ids === previousElicitationIds) {
      previousElicitationIds = ids;
      return;
    }
    previousElicitationIds = ids;
    requestAnimationFrame(() => {
      const first = areaRef?.querySelector<HTMLElement>('[data-elicitation-id]');
      first?.scrollIntoView({ block: 'start', behavior: 'auto' });
      setHasNewContent(false);
    });
  });

  const jumpToLatest = () => {
    if (!areaRef) return;
    areaRef.scrollTo({ top: areaRef.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setStick(true);
    setHasNewContent(false);
  };

  const completionAnnouncement = () => {
    const entry = [...chatEntries()].reverse().find((item) => item.role === 'assistant' && ['completed', 'failed', 'cancelled', 'interrupted'].includes(item.status || ''));
    if (!entry) return '';
    const status = entry.status === 'completed' ? 'completed' : entry.status === 'failed' ? 'failed' : entry.status === 'cancelled' ? 'cancelled' : 'interrupted';
    const timestamp = messageTime(entry.createdAt);
    return `Assistant response ${status}${timestamp ? `, ${timestamp.label}` : ''}`;
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
      {/* 居中正文列：宽屏 max-w 820px 居中留白（§3.13 验收 8），窄屏 16px
          padding；上 24px 按 §3.4，底部 156px 留白等 F7 Composer 悬浮 */}
      <div class="message-list-content w-full max-w-(--container-chat) mx-auto py-24 px-16 desk:max-wide:max-w-(--container-chat-narrow) desk:max-wide:px-18 max-desk:max-w-(--container-chat-narrow)">
        <ElicitationQueue
          elicitations={elicitations()}
          responding={elicitationResponses()}
          readOnly={readOnly()}
          onRespond={respondElicitation}
        />
        <PermissionBar />
        <Show when={!runtimeDocsHydrated()}>
          <div class="conversation-placeholder flex min-h-(--container-placeholder-narrow) flex-col items-center justify-center text-text-secondary text-center" role="status">
            <span class="ui-spinner w-18 h-18 mb-14" aria-hidden="true" />
            <strong class="text-text-primary text-16 font-semibold -tracking-1">Loading session</strong>
            <p class="max-w-390 mt-7 text-text-muted text-13 leading-155">Restoring messages and runtime state from the Peri Studio server…</p>
          </div>
        </Show>
        <Show when={runtimeDocsHydrated() && chatEntries().length === 0 && !outboxForChat()}>
          <div class="conversation-placeholder conversation-placeholder--empty flex min-h-(--container-placeholder) flex-col items-center justify-center text-text-secondary text-center">
            <span class="conversation-placeholder__mark grid w-38 h-38 mb-14 place-items-center rounded-12 bg-empty-mark-bg text-empty-mark-fg text-14" aria-hidden="true">✦</span>
            <strong class="text-text-primary text-16 font-semibold -tracking-1">Start this conversation</strong>
            <p class="max-w-390 mt-7 text-text-muted text-13 leading-155">Send the first message. Content is saved to this session and can be restored later.</p>
          </div>
        </Show>
        {/* 显式稳定 key（等效 itemKey）：Solid 1.9 的 <For> 没有 React 式 key
            prop，它按 item 引用做 diff；而 chatEntries() 每次 Yjs 投影都全量
            重建对象（store.ts:403 renderChat），任何单条更新都会让全部引用
            失配 → 整个列表 DOM 重挂载，滚动跟随与气泡内部状态随之丢失。
            ChatEntry.id 是 chat-view.ts 中 Yjs entries map 的稳定键，这里外层
            <For> 按 id 字符串序列渲染稳定槽位（字符串按值相等，diff 正确），
            内层 keyed <Show> 随最新投影更新条目内容，等效于显式 itemKey。 */}
        <For each={chatEntryIds()}>
          {(id, index) => (
            <Show when={chatEntriesById().get(id)} keyed>
              {(entry) => <>
                <Show when={replayBoundaryAt(chatEntries(), index())}>{(kind) => <HistoryBoundary kind={kind()} />}</Show>
                <ConversationMessage entry={entry} />
              </>}
            </Show>
          )}
        </For>
        <Show when={outboxForChat()}>{(submission) =>
          <MessageOutbox submission={submission()} onRetry={retryMessageSubmission} onEdit={dismissFailedMessageDelivery} />
        }</Show>
      </div>
    </section>
    <Show when={!stick() || hasNewContent()}><Button type="button" size="compact" class="jump-latest absolute z-12 bottom-12 left-1/2 -translate-x-1/2 min-h-36 px-13 border border-border-subtle rounded-full bg-surface-translucent text-text-secondary shadow-popover cursor-pointer text-12 backdrop-blur-sm hover:text-text-primary pointer-coarse:min-h-44 pointer-coarse:px-16" onClick={jumpToLatest}>{hasNewContent() ? '↓ New content' : '↓ Back to latest'}</Button></Show>
    </div>
  );
}
