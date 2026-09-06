// 连接生命周期模块（P3 自 store.ts 拆出）。
//
// ws 生命周期 + 状态回调 + 心跳 + 连接门控 + 会话记忆全部收敛在这里：
// busy/connState/heartbeatCount/promptDeliveryReady/connectionProblem 信号、
// connectWithCookie/reconnect/disconnect/resetConnectionState、
// onStatus 状态机回调（connectionTransition 驱动）、
// rememberSession/readRememberedSession/forgetRememberedSession。
//
// 依赖纪律：本模块不 import store.ts。下行帧与业务回调（onFrame/
// onProtocolIssue/sendSubscribe/onReady/settleConnectionLoss/onConnectionLost/
// onAuthInvalidation/toast）由 store 组合根通过 installConnection 注入；
// principalRole 直接取自 lib/auth-state（lib 模块之间可互相 import）。

import { createSignal } from 'solid-js';
import * as H from './protocol';
import { WsClient } from './ws-client';
import type { ConnStatus, ConnDetail, WsProtocolIssue } from './ws-client';
import { connectionTransition } from './connection-state';
import type { ConnectionProblem } from './recovery-state';
import { principalRole } from './auth-state';

export const [busy, setBusy] = createSignal(false);
export const [connState, setConnState] = createSignal<{ text: string; kind: 'idle' | 'ok' | 'warn' | 'err' }>({
  text: 'Disconnected',
  kind: 'idle',
});
export const [heartbeatCount, setHeartbeatCount] = createSignal(0);
export const [promptDeliveryReady, setPromptDeliveryReady] = createSignal(false);
export const [promptMaxBytes, setPromptMaxBytes] = createSignal(0);
export const [connectionProblem, setConnectionProblem] = createSignal<ConnectionProblem | null>(null);
const [connectionReady, setConnectionReady] = createSignal(false);
export { connectionReady };

let ws: WsClient | null = null; // 当前 WsClient
let connectionEpoch = 0; // 隔离被替换连接的延迟 status/frame 回调
const LAST_SESSION_KEY = 'peri-studio:last-session';

interface ConnectionDeps {
  settleConnectionLoss: () => void;
  onBeforeDisconnect?: () => void;
  onConnectionLost: () => void;
  onAuthInvalidation: (reason: string) => void;
  toast: (msg: string) => void;
  sendSubscribe: () => void;
  onReady: () => void;
  onFrame: (frame: H.DownstreamFrame) => void;
  onProtocolIssue: (issue: WsProtocolIssue) => void;
}

let deps: ConnectionDeps | null = null;

/** store 组合根装配入口：注入来自 store 的运行时依赖（须在使用前调用一次）。 */
export function installConnection(d: ConnectionDeps): void {
  deps = d;
}

/** 通过当前连接发送任意帧（订阅/取消订阅/action 共用；未连接时返回 false）。 */
export function sendFrame(frame: unknown): boolean { return !!ws?.send(frame); }

function wsUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  return scheme + window.location.host + '/';
}

export function connectWithCookie(): void {
  deps!.settleConnectionLoss();
  setConnectionReady(false);
  const epoch = ++connectionEpoch;
  if (ws) ws.close();
  const client = new WsClient({
    url: wsUrl(),
    onStatus: (state, detail) => { if (epoch === connectionEpoch) handleStatus(state, detail); },
    onFrame: (frame) => { if (epoch === connectionEpoch) deps!.onFrame(frame); },
    onProtocolIssue: (issue) => { if (epoch === connectionEpoch) deps!.onProtocolIssue(issue); },
  });
  ws = client;
  client.connect();
  setBusy(true);
  setConnectionProblem(null);
}

export function reconnect(): void { connectWithCookie(); }

export function disconnect(): void {
  deps!.onBeforeDisconnect?.();
  deps!.settleConnectionLoss();
  connectionEpoch += 1;
  setConnectionReady(false);
  setPromptDeliveryReady(false);
  setPromptMaxBytes(0);
  deps!.onConnectionLost();
  if (ws) {
    ws.close();
    ws = null;
  }
  setBusy(false);
}

/** 身份边界重置（resetAuthenticatedSession 调用）：连接信号回到初始态。 */
export function resetConnectionState(): void {
  setConnectionReady(false);
  setConnState({ text: 'Disconnected', kind: 'idle' });
  setHeartbeatCount(0);
  setPromptDeliveryReady(false);
  setPromptMaxBytes(0);
  setConnectionProblem(null);
}

export function rememberSession(sessionId: string): void {
  try { window.localStorage.setItem(LAST_SESSION_KEY, sessionId); } catch { /* 浏览器禁用存储时退化为手动选择 */ }
}

export function readRememberedSession(): string | null {
  let preferred: string | null = null;
  try { preferred = window.localStorage.getItem(LAST_SESSION_KEY); } catch { /* 手动选择兜底 */ }
  return preferred;
}

export function forgetRememberedSession(): void {
  try { window.localStorage.removeItem(LAST_SESSION_KEY); } catch { /* UI preference only */ }
}

// ── 连接状态机回调（ws-client）────────────────────────────────────────

function handleStatus(state: ConnStatus, detail: ConnDetail): void {
  const transition = connectionTransition(state, detail, !!principalRole());
  if (transition) {
    setConnectionReady(transition.ready);
    setBusy(transition.busy);
    setConnState(transition.status);
    setConnectionProblem(transition.problem);
  }
  switch (state) {
    case 'connecting':
      setPromptDeliveryReady(false);
      setPromptMaxBytes(0);
      break;
    case 'open':
      // 已发 auth；认证后首帧必须是 ysync.subscribe 或 action ——
      // 立即重放订阅（首次连接与重连同一路径，快照兜底）。
      deps!.sendSubscribe();
      break;
    case 'ready':
      const maxPromptBytes = Number.isSafeInteger(detail.maxPromptBytes) && Number(detail.maxPromptBytes) > 0
        ? Number(detail.maxPromptBytes)
        : 0;
      setPromptMaxBytes(maxPromptBytes);
      setPromptDeliveryReady(
        Array.isArray(detail.negotiatedCapabilities)
          && detail.negotiatedCapabilities.includes(H.CAP_PROMPT_DELIVERY_V2)
          && maxPromptBytes > 0,
      );
      deps!.onReady();
      break;
    case 'heartbeat':
      setHeartbeatCount((c) => c + 1);
      break;
    case 'reconnecting':
      deps!.settleConnectionLoss();
      break;
    case 'fatal':
      deps!.settleConnectionLoss();
      deps!.onConnectionLost();
      if (detail.code === 4502) {
        deps!.onAuthInvalidation('The browser session is invalid, the access token was revoked, or the server auth configuration changed. Please sign in again.');
        break;
      }
      deps!.toast(
        `Connection terminated (${detail.code}): ` +
        (detail.code === 4500 ? 'instance offline' :
          detail.code === 4501 ? 'heartbeat timeout' :
          detail.code === 4502 ? 'auth/configuration failure' : 'unknown reason') +
        ', no auto-reconnect',
      );
      break;
    case 'closed':
      deps!.settleConnectionLoss();
      deps!.onConnectionLost();
      break;
    default:
      break;
  }
}
