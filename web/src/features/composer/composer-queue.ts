import { createSignal } from 'solid-js';
import type { ComposerQueueItem } from '@peri/ui';

/** 按 project session 分桶的待发队列；server 能力就绪前默认为空，不伪造历史。 */
const [queueBySession, setQueueBySession] = createSignal<Record<string, ComposerQueueItem[]>>({});

function sessionKey(sessionId: string | null | undefined): string | null {
  return sessionId?.trim() ? sessionId : null;
}

/** 当前 session 的待发条目（只读投影）。 */
export function composerQueueItems(sessionId: string | null | undefined): ComposerQueueItem[] {
  const key = sessionKey(sessionId);
  if (!key) return [];
  return queueBySession()[key] ?? [];
}

/** 供未来 server 投影或本地入队写入；当前生产路径不调用。 */
export function setComposerQueueItems(sessionId: string, items: ComposerQueueItem[]): void {
  const key = sessionKey(sessionId);
  if (!key) return;
  setQueueBySession((current) => ({ ...current, [key]: items }));
}

/** 从队列移除一条（占位回调，待协议落地）。 */
export function removeComposerQueueItem(sessionId: string | null | undefined, itemId: string): void {
  const key = sessionKey(sessionId);
  if (!key) return;
  setQueueBySession((current) => ({
    ...current,
    [key]: (current[key] ?? []).filter((item) => item.id !== itemId),
  }));
}

/** 立即发送队列条目（占位，待 server 命令）。 */
export function sendComposerQueueItemNow(_sessionId: string | null | undefined, _itemId: string): void {
  // 协议未接入：保留接口供 Composer 绑定。
}

/** 将队列条目回填到草稿（占位，待 server 命令）。 */
export function editComposerQueueItem(_sessionId: string | null | undefined, _itemId: string): void {
  // 协议未接入：保留接口供 Composer 绑定。
}

/** 更多队列操作（占位菜单入口）。 */
export function moreComposerQueueAction(_sessionId: string | null | undefined, _itemId: string): void {
  // 协议未接入：保留接口供 Composer 绑定。
}

/** 测试与装配重置。 */
export function resetComposerQueue(): void {
  setQueueBySession({});
}
