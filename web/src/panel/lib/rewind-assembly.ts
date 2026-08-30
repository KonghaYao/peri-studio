// Rewind 装配模块（P3 自 store.ts 拆出）。
//
// 状态机（RewindFlow 类型与 transition）在 lib/rewind-flow.ts（纯函数）；
// 本模块承载装配层：rewindFlow 信号 + 五个动作（canRewindCurrentChat..
// closeRewindFlow）+ rewindQueries 查询表 + onFrame 两个 rewind case +
// action 错误归属，只被 RewindDialog 消费。
//
// 依赖纪律：本模块不 import store.ts。运行时依赖（selectedCid/ready/
// chatStatusSignal/chatHead/turnActive/sendAction/acknowledge/fail）由
// store 组合根通过 installRewind 注入；readOnly 直接取自 lib/auth-state。

import { createSignal } from 'solid-js';
import * as H from './protocol';
import { readOnly } from './auth-state';
import type { ControlView } from '@/entities/chat/control-view';
import type { Ack, ActionError, ActionFrame, ActionOptions } from './action-contract';
import {
  closedRewindFlow,
  completeRewind,
  executingRewind,
  failRewind,
  loadingRewindCandidates,
  loadingRewindPreview,
  receiveRewindCandidates,
  receiveRewindPreview,
  type RewindFlow,
} from './rewind-flow';

export const [rewindFlow, setRewindFlow] = createSignal<RewindFlow>(closedRewindFlow());

// 查询表：commandId → 查询意图，防止迟到的下行帧误落当前 UI 状态。
const rewindQueries = new Map<string, { kind: 'candidates' | 'preview'; chatId: string }>();

interface RewindDeps {
  selectedCid: () => string | null;
  ready: () => boolean;
  isTerminal: (status: string | undefined) => boolean;
  chatStatusSignal: () => Record<string, string>;
  chatHead: () => ControlView | null;
  turnActive: () => boolean;
  sendAction: (frame: ActionFrame, label: string, options: ActionOptions) => boolean;
  acknowledge: (ack: Ack) => void;
  fail: (err: ActionError) => void;
}

let deps: RewindDeps | null = null;

/** store 组合根装配入口：注入来自 store 的运行时依赖（须在使用前调用一次）。 */
export function installRewind(d: RewindDeps): void {
  deps = d;
}

export function canRewindCurrentChat(): boolean {
  const chatId = deps!.selectedCid();
  return !!chatId && deps!.ready() && !readOnly() && !deps!.turnActive()
    && !deps!.isTerminal(deps!.chatStatusSignal()[chatId])
    && deps!.chatHead()?.agent?.extensions?.includes('peri.rewind') === true;
}

export function openRewindFlow(): boolean {
  const chatId = deps!.selectedCid();
  if (!chatId || !canRewindCurrentChat()) return false;
  const frame = H.rewindCandidates(chatId);
  rewindQueries.set(frame.commandId, { kind: 'candidates', chatId });
  setRewindFlow(loadingRewindCandidates(chatId, frame.commandId));
  const sent = deps!.sendAction(frame, 'Fetch rewind candidates', {
    onTimeout: () => {
      rewindQueries.delete(frame.commandId);
      setRewindFlow((current) => failRewind(current, frame.commandId, 'TIMEOUT', 'Fetching rewind candidates timed out; you can safely retry the query.'));
    },
    onError: (error) => setRewindFlow((current) => failRewind(current, frame.commandId, error.code || 'ERROR', error.message || 'Failed to fetch rewind candidates.')),
  });
  if (!sent) rewindQueries.delete(frame.commandId);
  return sent;
}

export function previewRewind(candidate: H.RewindCandidate): boolean {
  const current = rewindFlow();
  if (current.kind !== 'select_target' || !canRewindCurrentChat() || current.chatId !== deps!.selectedCid()) return false;
  const frame = H.rewindPreview(current.chatId, candidate.messageId);
  rewindQueries.set(frame.commandId, { kind: 'preview', chatId: current.chatId });
  setRewindFlow(loadingRewindPreview(current, frame.commandId, candidate));
  const sent = deps!.sendAction(frame, 'Preview session rewind', {
    onTimeout: () => {
      rewindQueries.delete(frame.commandId);
      setRewindFlow((value) => failRewind(value, frame.commandId, 'TIMEOUT', 'The preview request timed out; no rewind was performed.'));
    },
    onError: (error) => setRewindFlow((value) => failRewind(value, frame.commandId, error.code || 'ERROR', error.message || 'Failed to generate a safe preview.')),
  });
  if (!sent) rewindQueries.delete(frame.commandId);
  return sent;
}

export function executeRewind(): boolean {
  const current = rewindFlow();
  if (current.kind !== 'confirm' || !canRewindCurrentChat() || current.chatId !== deps!.selectedCid()) return false;
  const frame = H.rewind(current.chatId, current.candidate.messageId, current.previewFingerprint);
  setRewindFlow(executingRewind(current, frame.commandId));
  return deps!.sendAction(frame, 'Execute session rewind', {
    retryOnUncertain: false,
    onTimeout: () => setRewindFlow((value) => failRewind(value, frame.commandId, 'DELIVERY_UNKNOWN', 'The server has not confirmed the rewind result. Do not run it again; reopen the session to verify the history.')),
    onError: (error) => setRewindFlow((value) => failRewind(value, frame.commandId, error.code || 'ERROR', error.message || 'Rewind failed.')),
    cb: () => setRewindFlow((value) => completeRewind(value, frame.commandId)),
  });
}

export function closeRewindFlow(): void {
  const current = rewindFlow();
  if (current.kind === 'executing') return;
  setRewindFlow(closedRewindFlow());
}

// ── onFrame 下行帧处理（store.onFrame 委托）──────────────────────────

export function handleRewindCandidates(frame: H.DownstreamFrame): void {
  const response = frame as unknown as H.RewindCandidatesFrame;
  const query = rewindQueries.get(response.commandId);
  if (!query || query.kind !== 'candidates' || query.chatId !== response.chatId) return;
  rewindQueries.delete(response.commandId);
  setRewindFlow((current) => receiveRewindCandidates(current, response));
  deps!.acknowledge({ commandId: response.commandId, status: 'committed' });
}

export function handleRewindPreview(frame: H.DownstreamFrame): void {
  const response = frame as unknown as H.RewindPreviewFrame;
  const query = rewindQueries.get(response.commandId);
  if (!query || query.kind !== 'preview' || query.chatId !== response.chatId) return;
  rewindQueries.delete(response.commandId);
  setRewindFlow((current) => receiveRewindPreview(current, response));
  deps!.acknowledge({ commandId: response.commandId, status: 'committed' });
}

// ── action 错误归属（store.onActionError 委托）────────────────────────

/** rewind 查询/执行中的错误不进入全局错误中心，由本模块消化。 */
export function rewindOwnsError(err: ActionError): boolean {
  const rewindQuery = err.commandId ? rewindQueries.get(err.commandId) : undefined;
  const rewindCommand = rewindFlow();
  if (rewindQuery || ('commandId' in rewindCommand && rewindCommand.commandId === err.commandId)) {
    if (err.commandId) rewindQueries.delete(err.commandId);
    deps!.fail(err);
    return true;
  }
  return false;
}

// ── 重置（selectChat / clearCurrentSelection / resetAuthenticatedSession）──

export function resetRewindState(): void {
  setRewindFlow(closedRewindFlow());
  rewindQueries.clear();
}
