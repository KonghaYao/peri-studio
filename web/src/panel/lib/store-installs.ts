// store 组合根特性装配模块（P1 自 store.ts 拆出）。
//
// 职责：面板错误中心（panel-errors）、用户动作（user-actions）、MCP、
// Rewind、PromptRecovery 五个特性模块的依赖注入装配。store.ts 只保留
// installConnection（其回调直接引用组合根的 invalidateAuthentication /
// sessionActivation / onFrame / sendSubscribe 定义）与本文件的单一入口。
//
// 依赖纪律：本模块不 import store.ts。信号/命令闭包等运行时依赖由组合
// 根经 installStoreWiring 一次注入；connectionReady/isTerminal 等叶子
// 模块符号直接导入。装配须在模块加载时调用一次，先于任何 UI 事件。

import type { Setter } from 'solid-js';
import { installPanelErrors, type PersistentError } from './panel-errors';
import { installUserActions, type SessionConfigMutation } from './user-actions';
import { installMcp } from './mcp';
import { installRewind } from './rewind-assembly';
import { installPromptRecovery } from './prompt-recovery-assembly';
import { isTerminal } from './action-state';
import { connectionReady } from './connection';
import type { DispatchResult } from './command-tracker';
import type { ControlView } from './control-view';
import type { Ack, ActionError, ActionFrame, ActionOptions } from './action-contract';
import type { ComposerDraftOwner } from './composer-draft';

export interface StoreWiringDeps {
  setPersistentErrors: (updater: (items: PersistentError[]) => PersistentError[]) => void;
  hasUncertain: (commandId: string) => boolean;
  forget: (commandId: string) => void;
  hasPending: (commandId: string) => boolean;
  retry: (commandId: string) => DispatchResult | null;
  toast: (msg: string) => void;
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
  sendAction: (frame: ActionFrame, label: string, options?: ActionOptions) => boolean;
  reconcileCurrentRuntimeControl: () => void;
  acknowledge: (ack: Ack) => void;
  fail: (err: ActionError) => void;
}

let deps: StoreWiringDeps | null = null;

/** store 组合根装配入口：注入来自 store 的运行时依赖（须在使用前调用一次）。 */
export function installStoreWiring(d: StoreWiringDeps): void {
  deps = d;
  installPanelErrors({
    setPersistentErrors: deps.setPersistentErrors,
    hasUncertain: deps.hasUncertain,
    forget: deps.forget,
    hasPending: deps.hasPending,
    retry: deps.retry,
    toast: deps.toast,
  });
  installUserActions({
    selectedCid: deps.selectedCid,
    openingSessionId: deps.openingSessionId,
    turnActive: deps.turnActive,
    currentCid: deps.currentCid,
    selectedSessionId: deps.selectedSessionId,
    composerDraftOwner: deps.composerDraftOwner,
    chatStatusSignal: deps.chatStatusSignal,
    chatHead: deps.chatHead,
    sessionConfigMutation: deps.sessionConfigMutation,
    setSessionConfigMutation: deps.setSessionConfigMutation,
    toast: deps.toast,
    sendAction: deps.sendAction,
    hasUncertain: deps.hasUncertain,
    retry: deps.retry,
    reconcileCurrentRuntimeControl: deps.reconcileCurrentRuntimeControl,
  });
  installMcp({
    selectedCid: deps.selectedCid,
    ready: connectionReady,
    sendAction: deps.sendAction,
    acknowledge: deps.acknowledge,
  });
  installRewind({
    selectedCid: deps.selectedCid,
    ready: connectionReady,
    isTerminal,
    chatStatusSignal: deps.chatStatusSignal,
    chatHead: deps.chatHead,
    turnActive: deps.turnActive,
    sendAction: deps.sendAction,
    acknowledge: deps.acknowledge,
    fail: deps.fail,
  });
  installPromptRecovery({
    selectedSessionId: deps.selectedSessionId,
    ready: connectionReady,
    sendAction: deps.sendAction,
    acknowledge: deps.acknowledge,
    fail: deps.fail,
  });
}
