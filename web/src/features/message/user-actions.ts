// 用户动作模块（P1 自 store.ts 拆出）。
//
// 职责：UI 直接触发的用户动作 —— 发送消息/重试提交、取消回合、关闭
// 会话、权限决策、elicitation 应答、会话配置修改。动作经 sendAction
// 走 CommandTracker 生命周期，业务投递状态由 message-delivery/
// runtime-control/permission-delivery 维护。
//
// 依赖纪律：本模块不 import store.ts。store 侧信号（selectedCid/
// chatStatusSignal 等）与 sendAction 由组合根通过 installUserActions
// 注入；lib 模块（protocol/action-state/connection 等）之间可直接互相
// import。

import type { Setter } from 'solid-js';
import * as H from '@/shared/protocol/client';
import { isTerminal } from '@/features/runtime/action-state';
import { connectionReady, promptDeliveryReady, promptMaxBytes } from '@/features/connection/connection';
import { promptFitsBudget } from '@/shared/lib/prompt-budget';
import { readOnly } from '@/features/auth/auth-state';
import type { ControlView } from '@/entities/chat/control-view';
import type { ActionFrame, ActionOptions } from '@/shared/protocol/action-contract';
import {
  acceptMessageDelivery,
  blockUnknownMessageDelivery,
  completeMessageDelivery,
  failMessageDelivery,
  markMessageDeliveryUncertain,
  messageSubmission,
  retryMessageDelivery,
  startMessageDelivery,
} from '@/features/message/message-delivery';
import { tearDownMcpAppsForChat } from '@/features/mcp/mcp-apps';
import {
  acceptRuntimeControl,
  confirmRuntimeControl,
  failRuntimeControl,
  markRuntimeControlUncertain,
  runtimeControlBusy,
  startRuntimeControl,
} from '@/features/runtime/runtime-control';
import {
  failPermissionDecision,
  markPermissionDecisionUncertain,
  startPermissionDecision,
  type PermissionDecision,
} from '@/features/message/permission-delivery';
import {
  completeElicitationResponse,
  elicitationResponses,
  failElicitationResponse,
  markElicitationResponseUncertain,
  rollbackElicitationResponse,
  startElicitationResponse,
} from '@/features/message/elicitation-delivery';
import {
  completeQuestionResponse,
  failQuestionResponse,
  markQuestionResponseUncertain,
  questionResponses,
  rollbackQuestionResponse,
  startQuestionResponse,
} from '@/features/message/question-delivery';
import type { QuestionAnswerPayload } from '@/shared/protocol/client';
import { persistActionProblem, retryPersistentAction } from './panel-errors';
import type { DispatchResult } from '@/features/connection/command-tracker';
import type { ComposerDraftOwner } from '@/features/composer/composer-draft';

/** 会话配置修改的运行时状态（SessionConfigDialog 消费）。 */
export interface SessionConfigMutation {
  commandId: string;
  chatId: string;
  configId: string;
  value: string;
  previousValue: string;
  phase: 'sending' | 'accepted' | 'uncertain';
}

export interface UserActionsDeps {
  selectedCid: () => string | null;
  openingSessionId: () => string | null;
  turnActive: () => boolean;
  currentCid: () => string | null;
  selectedSessionId: () => string | null;
  composerDraftOwner: () => ComposerDraftOwner | null;
  chatStatusSignal: () => Record<string, string>;
  chatHead: () => ControlView | null;
  sessionConfigMutation: () => SessionConfigMutation | null;
  setSessionConfigMutation: Setter<SessionConfigMutation | null>;
  toast: (msg: string) => void;
  sendAction: (frame: ActionFrame, label: string, options?: ActionOptions) => boolean;
  hasUncertain: (commandId: string) => boolean;
  retry: (commandId: string) => DispatchResult | null;
  reconcileCurrentRuntimeControl: () => void;
}

let deps: UserActionsDeps | null = null;

/** store 组合根装配入口：注入来自 store 的运行时依赖（须在使用前调用一次）。 */
export function installUserActions(d: UserActionsDeps): void {
  deps = d;
}

export function sendMessage(text: string, effort?: string): boolean {
  const sessionId = deps!.selectedSessionId();
  if (!connectionReady() || !promptDeliveryReady() || readOnly() || deps!.openingSessionId() || deps!.turnActive() || messageSubmission(sessionId)) {
    if (!promptDeliveryReady()) { deps!.toast('Secure message delivery is not enabled on the server; refresh or upgrade the server'); return false; }
    if (readOnly()) { deps!.toast('Read-only mode cannot send messages'); return false; }
    if (deps!.openingSessionId()) { deps!.toast('Session is opening'); return false; }
    if (deps!.turnActive()) { deps!.toast('Agent is working; stop the current task first'); return false; }
    if (messageSubmission(sessionId)) { deps!.toast('This session message is still being confirmed'); return false; }
    deps!.toast('Connection not ready, try again later');
    return false;
  }
  const chatId = deps!.currentCid();
  if (!chatId) {
    deps!.toast('Select a conversation first');
    return false;
  }
  if (!sessionId) {
    deps!.toast('Persistent session is not ready');
    return false;
  }
  const draftOwner = deps!.composerDraftOwner();
  if (!draftOwner || draftOwner.sessionId !== sessionId) {
    deps!.toast('Persistent draft identity is not ready');
    return false;
  }
  if (!promptFitsBudget(text, promptMaxBytes())) {
    deps!.toast(`Message exceeds the negotiated ${promptMaxBytes()} byte limit`);
    return false;
  }
  if (isTerminal(deps!.chatStatusSignal()[chatId])) {
    deps!.toast('Conversation ended, cannot send messages');
    return false;
  }
  tearDownMcpAppsForChat(chatId);
  const frame = H.prompt(chatId, text, effort);
  if (!startMessageDelivery(frame.commandId, text, sessionId, chatId, draftOwner)) {
    deps!.toast('Previous message is still being confirmed');
    return false;
  }
  const sent = deps!.sendAction(frame, 'prompt', {
    acceptedStartsInactivityLease: true,
    retryOnUncertain: true,
    onAccepted: () => acceptMessageDelivery(frame.commandId),
    onTimeout: () => markMessageDeliveryUncertain(frame.commandId),
    onError: (err) => err.code === 'DELIVERY_UNKNOWN'
      ? blockUnknownMessageDelivery(frame.commandId, err.message)
      : failMessageDelivery(frame.commandId, err.message || 'Message submission failed'),
    cb: (ack) => completeMessageDelivery(frame.commandId, ack.status),
  });
  return sent;
}

export function retryMessageSubmission(): void {
  const sessionId = deps!.selectedSessionId();
  const current = messageSubmission(sessionId);
  if (!current || current.phase !== 'uncertain' || !deps!.hasUncertain(current.commandId)) return;
  if (!connectionReady()) return deps!.toast('Connection not ready, cannot re-confirm now');
  const result = deps!.retry(current.commandId);
  if (result === 'sent') retryMessageDelivery(current.commandId);
  else deps!.toast('Connection not ready; the original request is preserved');
}

export function cancelTurn(): void {
  if (!connectionReady() || readOnly()) {
    deps!.toast('Connection not ready, try again later');
    return;
  }
  const chatId = deps!.currentCid();
  if (!chatId) return;
  if (isTerminal(deps!.chatStatusSignal()[chatId])) {
    deps!.toast('Conversation ended, nothing to cancel');
    return;
  }
  const frame = H.cancel(chatId);
  if (!startRuntimeControl(frame.commandId, chatId, 'cancel')) return deps!.toast('A control request for this runtime is already being confirmed');
  deps!.sendAction(frame, 'cancel', {
    retryOnUncertain: true,
    onAccepted: () => acceptRuntimeControl(frame.commandId),
    cb: (ack) => { if (confirmRuntimeControl(frame.commandId, ack.status)) deps!.reconcileCurrentRuntimeControl(); },
    onError: (error) => failRuntimeControl(frame.commandId, error.message || 'Failed to stop current generation.'),
    onTimeout: () => {
      markRuntimeControlUncertain(frame.commandId);
      persistActionProblem('Stop result not yet confirmed', 'The stop request may still be running. Re-confirm with the original request; do not submit repeated stop operations.', frame.commandId);
    },
  });
}

export function setSessionConfig(configId: string, value: string): boolean {
  const chatId = deps!.selectedCid();
  const catalog = deps!.chatHead()?.agent?.configOptions ?? [];
  if (!chatId || readOnly() || deps!.turnActive() || deps!.sessionConfigMutation()) return false;
  const option = catalog.find((candidate) => candidate.id === configId
    && candidate.options.some((choice) => choice.value === value));
  if (!option) return false;
  const frame = H.configSet(chatId, configId, value);
  deps!.setSessionConfigMutation({ commandId: frame.commandId, chatId, configId, value, previousValue: option.currentValue, phase: 'sending' });
  const sent = deps!.sendAction(frame, 'Update agent session config', {
    onAccepted: () => deps!.setSessionConfigMutation((current) => current?.commandId === frame.commandId
      ? { ...current, phase: 'accepted' }
      : current),
    cb: () => deps!.setSessionConfigMutation((current) => current?.commandId === frame.commandId ? null : current),
    onTimeout: () => deps!.setSessionConfigMutation((current) => current?.commandId === frame.commandId
      ? { ...current, phase: 'uncertain' }
      : current),
    onError: (failure) => deps!.setSessionConfigMutation((current) => {
      if (current?.commandId !== frame.commandId) return current;
      return failure.code === 'DELIVERY_UNKNOWN' ? { ...current, phase: 'uncertain' } : null;
    }),
  });
  if (!sent) deps!.setSessionConfigMutation(null);
  return sent;
}

export function retrySessionConfigMutation(): boolean {
  const mutation = deps!.sessionConfigMutation();
  if (!mutation || mutation.phase !== 'uncertain') return false;
  deps!.setSessionConfigMutation({ ...mutation, phase: 'sending' });
  const sent = retryPersistentAction(mutation.commandId);
  if (!sent) deps!.setSessionConfigMutation(mutation);
  return sent;
}

export interface CloseRuntimeOptions {
  onCommitted?: () => void;
  onFailed?: () => void;
  onUncertain?: () => void;
  /** 归档编排：不单独 toast 关闭成功，避免连发两条提示。 */
  quiet?: boolean;
}

/** 关闭任意 chat 的运行实例；已终态视为成功，便于归档前收敛 live runtime。 */
export function closeRuntimeInstance(chatId: string, options: CloseRuntimeOptions = {}): boolean {
  if (!connectionReady() || readOnly()) {
    deps!.toast('Connection not ready, try again later');
    options.onFailed?.();
    return false;
  }
  if (!chatId || runtimeControlBusy(chatId)) {
    options.onFailed?.();
    return false;
  }
  if (isTerminal(deps!.chatStatusSignal()[chatId])) {
    options.onCommitted?.();
    return true;
  }
  const frame = H.close(chatId);
  if (!startRuntimeControl(frame.commandId, chatId, 'close')) {
    options.onFailed?.();
    return false;
  }
  const sent = deps!.sendAction(frame, 'Close runtime instance', {
    retryOnUncertain: true,
    onAccepted: () => acceptRuntimeControl(frame.commandId),
    cb: (ack) => {
      if (!confirmRuntimeControl(frame.commandId, ack.status)) return;
      deps!.reconcileCurrentRuntimeControl();
      if (!options.quiet) deps!.toast('Runtime instance closed; session is still saved in the project');
      options.onCommitted?.();
    },
    onError: (error) => {
      failRuntimeControl(frame.commandId, error.message || 'Failed to close runtime instance.');
      options.onFailed?.();
    },
    onTimeout: () => {
      markRuntimeControlUncertain(frame.commandId);
      persistActionProblem('Close result not yet confirmed', 'The runtime may already be closed. Persistent sessions on the left are not deleted; re-confirm with the original request.', frame.commandId);
      options.onUncertain?.();
    },
  });
  if (!sent) {
    failRuntimeControl(frame.commandId, 'Connection not ready');
    options.onFailed?.();
  }
  return sent;
}

export function closeChat(onFinished?: () => void): boolean {
  const chatId = deps!.currentCid();
  if (!chatId) return false;
  if (isTerminal(deps!.chatStatusSignal()[chatId])) {
    if (!connectionReady() || readOnly()) {
      deps!.toast('Connection not ready, try again later');
      return false;
    }
    deps!.toast('Conversation ended, nothing to close');
    return false;
  }
  return closeRuntimeInstance(chatId, { onCommitted: onFinished, onUncertain: onFinished });
}

export function resolvePermission(permissionId: string, decision: PermissionDecision, optionId?: string): void {
  if (!connectionReady() || readOnly()) {
    if (readOnly()) return deps!.toast('Read-only mode cannot handle permission requests');
    deps!.toast('Connection not ready, try again later');
    return;
  }
  const chatId = deps!.currentCid();
  if (!chatId) return;
  const frame = H.resolvePermission(chatId, permissionId, decision, optionId);
  if (!startPermissionDecision(frame.commandId, permissionId, decision)) return;
  deps!.sendAction(frame, 'resolve', {
    retryOnError: true,
    onError: (error) => error.retryable
      ? markPermissionDecisionUncertain(frame.commandId, true)
      : failPermissionDecision(frame.commandId),
    onTimeout: () => {
      markPermissionDecisionUncertain(frame.commandId);
      persistActionProblem('Permission decision result not yet confirmed', 'Wait for the request to disappear or return an error; do not submit the opposite decision.', frame.commandId);
    },
  });
}

export function respondElicitation(
  elicitationId: string,
  action: 'accept' | 'decline' | 'cancel',
  answers: Record<string, H.ElicitationAnswer> = {},
): void {
  if (!connectionReady() || readOnly()) {
    deps!.toast(readOnly() ? 'Read-only mode cannot answer Peri' : 'Connection not ready, try again later');
    return;
  }
  const chatId = deps!.currentCid();
  if (!chatId || elicitationResponses()[elicitationId]) return;
  const frame = H.respondElicitation(chatId, elicitationId, action, answers);
  if (!startElicitationResponse(elicitationId, frame.commandId)) return;
  const sent = deps!.sendAction(frame, 'Answer Peri', {
    cb: (ack) => completeElicitationResponse(ack.commandId || frame.commandId),
    onError: (error) => {
      if (error.code === 'DELIVERY_UNKNOWN') markElicitationResponseUncertain(frame.commandId, 'delivery_unknown');
      else failElicitationResponse(frame.commandId);
    },
    onTimeout: () => {
      markElicitationResponseUncertain(frame.commandId, 'uncertain');
      persistActionProblem(
        'Answer result not yet confirmed',
        'Peri may have already received this answer. Refresh the question status; never submit the answer again.',
        frame.commandId,
      );
    },
  });
  if (!sent) rollbackElicitationResponse(frame.commandId);
}

export function respondQuestion(questionId: string, answers: QuestionAnswerPayload[]): void {
  if (!connectionReady() || readOnly()) {
    deps!.toast(readOnly() ? 'Read-only mode cannot answer Peri' : 'Connection not ready, try again later');
    return;
  }
  const chatId = deps!.currentCid();
  if (!chatId || questionResponses()[questionId]) return;
  const frame = H.respondQuestion(chatId, questionId, answers);
  if (!startQuestionResponse(questionId, frame.commandId)) return;
  const sent = deps!.sendAction(frame, 'Answer Peri', {
    cb: (ack) => completeQuestionResponse(ack.commandId || frame.commandId),
    onError: (error) => {
      if (error.code === 'DELIVERY_UNKNOWN') markQuestionResponseUncertain(frame.commandId, 'delivery_unknown');
      else failQuestionResponse(frame.commandId);
    },
    onTimeout: () => {
      markQuestionResponseUncertain(frame.commandId, 'uncertain');
      persistActionProblem(
        'Answer result not yet confirmed',
        'Peri may have already received this answer. Refresh the question status; never submit the answer again.',
        frame.commandId,
      );
    },
  });
  if (!sent) rollbackQuestionResponse(frame.commandId);
}
