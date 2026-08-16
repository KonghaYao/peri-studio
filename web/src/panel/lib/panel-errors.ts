// persistentErrors 面板错误模块（P1 自 store.ts 拆出）。
//
// 职责：错误条目的合并/淘汰策略（retainPersistentErrors）、持久错误的
// 展示/重试与传输层问题上报（dismissPersistentError/retryPersistentAction/
// reportTransportIssue）、action 错误码文案映射（ERROR_REASONS）。
//
// 依赖纪律：本模块不 import store.ts。setPersistentErrors 与 commands
// 相关回调由 store 组合根通过 installPanelErrors 注入；connectionReady/
// sendFrame/retryRuntimeControl/retryPermissionDecision 直接取自 lib
// 模块（lib 模块之间可互相 import）。

import { connectionReady } from './connection';
import { retryRuntimeControl } from './runtime-control';
import { retryPermissionDecision } from './permission-delivery';
import type { WsProtocolIssue } from './ws-client';
import type { DispatchResult } from './command-tracker';

export interface PersistentError {
  id: number;
  title: string;
  detail: string;
  commandId: string | null;
  retryable: boolean;
  retrying: boolean;
}

/** action 错误码 → 面板文案（onActionError 消费）。 */
export const ERROR_REASONS: Record<string, string> = {
  CHAT_NOT_FOUND: 'Chat not found or closed',
  INSTANCE_OFFLINE: 'Instance offline',
  FORBIDDEN: 'Forbidden (insufficient token role?)',
  VERSION_CONFLICT: 'Version conflict',
  RATE_LIMITED: 'Rate limited',
  AGENT_UNAVAILABLE: 'Agent unavailable',
  PAYLOAD_TOO_LARGE: 'Payload too large',
  UNSUPPORTED_FRAME: 'Unsupported operation',
  UNAUTHENTICATED: 'Not authenticated',
  INVALID_STATE: 'Invalid state',
  DELIVERY_UNKNOWN: 'Delivery outcome unknown',
};

export interface PanelErrorsDeps {
  setPersistentErrors: (updater: (items: PersistentError[]) => PersistentError[]) => void;
  hasUncertain: (commandId: string) => boolean;
  forget: (commandId: string) => void;
  hasPending: (commandId: string) => boolean;
  retry: (commandId: string) => DispatchResult | null;
  toast: (msg: string) => void;
}

let deps: PanelErrorsDeps | null = null;
let problemSeq = 0;

/** store 组合根装配入口：注入来自 store 的运行时依赖（须在使用前调用一次）。 */
export function installPanelErrors(d: PanelErrorsDeps): void {
  deps = d;
}

export function dismissPersistentError(id: number): void {
  deps!.setPersistentErrors((items) => {
    const target = items.find((item) => item.id === id);
    if (target?.commandId) deps!.forget(target.commandId);
    return items.filter((item) => item.id !== id);
  });
}

export function retainPersistentErrors(items: PersistentError[], next: PersistentError): PersistentError[] {
  const merged = [...items.filter((item) => !next.commandId || item.commandId !== next.commandId), next];
  const protectedErrors = merged.filter((item) => item.retryable || item.retrying);
  const ordinarySlots = Math.max(0, 5 - protectedErrors.length);
  const retainedOrdinaryIds = new Set((ordinarySlots === 0 ? [] : merged
    .filter((item) => !item.retryable && !item.retrying)
    .slice(-ordinarySlots))
    .map((item) => item.id));
  return merged.filter((item) => item.retryable || item.retrying || retainedOrdinaryIds.has(item.id));
}

export function persistActionProblem(title: string, detail: string, commandId?: string): void {
  deps!.setPersistentErrors((items) => retainPersistentErrors(items, {
    id: ++problemSeq, title, detail, commandId: commandId || null, retryable: !!commandId && deps!.hasUncertain(commandId), retrying: false,
  }));
}

export function reportTransportIssue(issue: WsProtocolIssue): void {
  const problem = issue.kind === 'non_text_frame'
    ? { title: 'Unsupported server data received', detail: `Incoming WebSocket frame is not text (${issue.size} bytes); safely ignored without recording its content.` }
    : issue.kind === 'malformed_frame'
      ? { title: 'Malformed server data received', detail: `Incoming WebSocket text is not recognizable (${issue.size} characters); safely ignored without recording its content.` }
      : issue.kind === 'send_error'
        ? { title: 'Failed to write data to connection', detail: 'The browser connection failed at the moment of sending. The operation was not registered as sent; message drafts and recoverable state are preserved.' }
        : { title: 'Page failed to handle server update', detail: `The browser's ${issue.callback === 'frame' ? 'incoming data' : 'connection status'} handler threw. The connection stays open and later updates will still be processed.` };
  deps!.setPersistentErrors((items) => {
    const withoutDuplicate = items.filter((item) => item.title !== problem.title);
    return retainPersistentErrors(withoutDuplicate, {
      id: ++problemSeq,
      ...problem,
      commandId: null,
      retryable: false,
      retrying: false,
    });
  });
}

export function retryPersistentAction(commandId: string): boolean {
  if (!deps!.hasUncertain(commandId) || !connectionReady()) {
    deps!.toast(!deps!.hasUncertain(commandId) ? 'This action cannot be safely retried' : 'Connection not ready, cannot re-confirm now');
    return false;
  }
  if (deps!.hasPending(commandId)) return false;
  const sent = deps!.retry(commandId) === 'sent';
  if (sent) deps!.setPersistentErrors((items) => items.map((item) => item.commandId === commandId
    ? { ...item, title: 'Re-confirming', detail: 'Querying or completing the operation with the original commandId; no second request is created.', retryable: false, retrying: true }
    : item));
  if (sent) retryRuntimeControl(commandId);
  if (sent) retryPermissionDecision(commandId);
  else persistActionProblem('Re-confirmation not sent', 'Connection not ready. The original request is preserved; confirm again once the connection is restored.', commandId);
  return sent;
}
