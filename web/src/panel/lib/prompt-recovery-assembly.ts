// PromptRecovery 装配模块（P3 自 store.ts 拆出）。
//
// 状态机（PromptRecoveryView / PromptRecoveryQueryGate / transition 函数）
// 在 lib/prompt-recovery.ts（纯逻辑）；本模块承载装配层：promptRecovery
// 信号 + requestPromptRecovery/refreshPromptRecovery + 查询表 + onFrame
// 的 prompt_status case + action 错误归属，只被 ChatView 消费。
//
// 依赖纪律：本模块不 import store.ts。运行时依赖（selectedSessionId/
// ready/sendAction/acknowledge/fail）由 store 组合根通过
// installPromptRecovery 注入。

import { createSignal } from 'solid-js';
import * as H from '@/shared/protocol/client';
import { ACK_TIMEOUT_MS, type Ack, type ActionError, type ActionFrame, type ActionOptions } from './action-contract';
import { beginPromptRecovery, completePromptRecovery, failPromptRecovery, promptRecoveryDiagnostic, PromptRecoveryQueryGate, type PromptRecoveryView } from './prompt-recovery';

export const [promptRecovery, setPromptRecovery] = createSignal<PromptRecoveryView | null>(null);

// Query identities outlive the first timeout for the same duration as
// CommandTracker's late-terminal window. This keeps late read failures out of
// the mutation error center without making the read retryable.
const promptRecoveryQueries = new PromptRecoveryQueryGate(ACK_TIMEOUT_MS * 2 + 1000);

interface PromptRecoveryDeps {
  selectedSessionId: () => string | null;
  ready: () => boolean;
  sendAction: (frame: ActionFrame, label: string, options: ActionOptions) => boolean;
  acknowledge: (ack: Ack) => void;
  fail: (err: ActionError) => void;
}

let deps: PromptRecoveryDeps | null = null;

/** store 组合根装配入口：注入来自 store 的运行时依赖（须在使用前调用一次）。 */
export function installPromptRecovery(d: PromptRecoveryDeps): void {
  deps = d;
}

export function requestPromptRecovery(sessionId: string): void {
  if (!deps!.ready() || promptRecoveryQueries.hasCurrentFor(sessionId)) return;
  console.debug('[prompt-recovery] starting history reconciliation', { sessionId });
  setPromptRecovery((previous) => beginPromptRecovery(previous, sessionId));
  const frame = H.persistedSessionPromptStatus(sessionId);
  promptRecoveryQueries.begin(frame.commandId, sessionId);
  const sent = deps!.sendAction(frame, 'Fetch message recovery status', {
    cb: () => undefined,
    onTimeout: () => {
      if (promptRecoveryQueries.isCurrent(frame.commandId, sessionId) && deps!.selectedSessionId() === sessionId) {
        setPromptRecovery((previous) => failPromptRecovery(previous, sessionId, 'The reconciliation request timed out. Existing records are kept; you can safely reconcile again.'));
        console.warn('[prompt-recovery] reconciliation failed: request timed out', { sessionId });
      }
      promptRecoveryQueries.timeout(frame.commandId);
    },
    onError: (failure) => {
      if (promptRecoveryQueries.isCurrent(frame.commandId, sessionId) && deps!.selectedSessionId() === sessionId) {
        setPromptRecovery((previous) => failPromptRecovery(previous, sessionId, failure.message || 'Cannot reconcile history messages right now. Existing records are kept.'));
        console.warn('[prompt-recovery] reconciliation failed', { sessionId, message: failure.message });
      }
    },
  });
  if (!sent) promptRecoveryQueries.finish(frame.commandId);
}

export function refreshPromptRecovery(): void {
  const sessionId = deps!.selectedSessionId();
  if (!sessionId) return;
  if (!deps!.ready()) {
    setPromptRecovery((previous) => failPromptRecovery(previous, sessionId, 'Connection not ready. Existing records are kept; reconcile again after the connection is restored.'));
    return;
  }
  requestPromptRecovery(sessionId);
}

// ── onFrame 下行帧处理（store.onFrame 委托）──────────────────────────

export function handlePromptStatus(frame: H.DownstreamFrame): void {
  const response = frame as { commandId: string; sessionId: string; truncated: boolean; evidenceIncomplete: boolean; prompts: H.PromptStatusItem[] };
  const ownership = promptRecoveryQueries.classify(response.commandId);
  // An unsolicited status frame must not be able to settle an unrelated
  // mutation that happens to share its claimed command id.
  if (!ownership) return;
  const match = promptRecoveryQueries.classify(response.commandId, response.sessionId);
  if (ownership === 'current' && match === null) {
    const current = promptRecovery();
    if (current) setPromptRecovery(failPromptRecovery(current, current.sessionId, 'The server returned a session record that does not match; this reconciliation result was ignored.'));
  } else if (match === 'current' && response.sessionId === deps!.selectedSessionId()) {
    setPromptRecovery(completePromptRecovery(response, new Date().toISOString()));
    const completed = promptRecovery();
    if (completed) console.info('[prompt-recovery] reconciliation complete', promptRecoveryDiagnostic(completed));
  }
  deps!.acknowledge({ commandId: response.commandId, status: 'committed' });
  promptRecoveryQueries.finish(response.commandId);
}

// ── action 错误归属（store.onActionError 委托）────────────────────────

/** prompt 恢复核对中的错误不进入全局错误中心，由本模块消化。 */
export function promptRecoveryOwnsError(err: ActionError): boolean {
  const recoveryQuery = promptRecoveryQueries.classify(err.commandId);
  if (recoveryQuery) {
    deps!.fail(err);
    if (err.commandId) promptRecoveryQueries.finish(err.commandId);
    return true;
  }
  return false;
}

// ── 重置（clearCurrentSelection / resetAuthenticatedSession）──────────

/** 取消当前核对（切换会话/清空选择时使用）。 */
export function clearPromptRecoverySelection(): void {
  promptRecoveryQueries.cancelCurrent();
  setPromptRecovery(null);
}

/** 全量清空（身份边界重置时使用）。 */
export function resetPromptRecoveryState(): void {
  promptRecoveryQueries.reset();
  setPromptRecovery(null);
}
