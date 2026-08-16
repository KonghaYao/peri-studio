import { createSignal } from 'solid-js';

/**
 * 编辑器草稿：按持久会话隔离的文本草稿。
 *
 * 原属 message-delivery.ts 的混合职责（投递状态机 + 草稿），拆出后投递
 * 状态机只关心 outbox 条目；草稿的写入/清空/恢复由 Composer 与失败返回
 * 编辑（dismissFailedMessageDelivery）共用。
 */
const [drafts, setDrafts] = createSignal<Record<string, string>>({});

export const composerDraft = (sessionId: string | null): string =>
  sessionId ? drafts()[sessionId] || '' : '';

export function setComposerDraft(sessionId: string | null, text: string): void {
  if (!sessionId) return;
  setDrafts((current) => ({ ...current, [sessionId]: text }));
}

export function clearComposerDraft(sessionId: string): void {
  setDrafts((current) => {
    if (!(sessionId in current)) return current;
    const next = { ...current };
    delete next[sessionId];
    return next;
  });
}

/** 仅当该会话当前没有非空草稿时恢复文本（保留用户更新的语义）。 */
export function restoreComposerDraft(sessionId: string, text: string): void {
  setDrafts((current) => (current[sessionId] ? current : { ...current, [sessionId]: text }));
}

export function resetComposerDrafts(): void {
  setDrafts({});
}
