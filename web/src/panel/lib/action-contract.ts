// action 契约类型（store 组合根与各装配模块共享）。
//
// store.ts 的 sendAction/CommandTracker 与 MCP/Rewind/PromptRecovery 等
// 装配模块通过同一组下行 ack/error 类型协作；类型定义收敛在共享模块，
// 避免装配模块为了类型而反向 import store.ts。

import * as H from '@/shared/protocol/client';

/** CommandTracker 的 ack 超时（毫秒）。查询表的失效窗口以它为基准。 */
export const ACK_TIMEOUT_MS = 30000;

export type ActionFrame = ReturnType<typeof H.action>;

export interface Ack {
  commandId?: string;
  status?: string;
  chatId?: string;
  turnId?: string;
  [key: string]: unknown;
}

export interface ActionError {
  commandId?: string;
  code?: string;
  message?: string;
  retryable?: boolean;
}

export interface ActionOptions {
  cb?: (ack: Ack) => void;
  onAccepted?: (ack: Ack) => void;
  onTimeout?: () => void;
  onError?: (err: ActionError) => void;
  retryOnUncertain?: boolean;
  retryOnError?: boolean;
  acceptedStartsInactivityLease?: boolean;
}
