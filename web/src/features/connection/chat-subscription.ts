// 会话订阅与对话选择装配模块（P1 自 store.ts 拆出）。
//
// 职责：registry 常驻订阅 + 当前对话（chat + control 双 doc）的订阅集
// （desiredDocs）、订阅重放（首次连接与断线重连共用；ysync.subscribe
// 幂等）与对话选择切换（selectChat）。
//
// 依赖纪律：本模块不 import store.ts。currentCid、UI 信号 setter 与
// 传输依赖（docStore/sendFrame/toast）由 store 组合根经
// installChatSubscription 注入；reconcileRuntimeControl/isTerminal/
// resetMcpState 等叶子模块符号直接导入，保持依赖方向单一。
//
// 生命周期约定：切换/清理时先退订后 drop（WebSocket 顺序保证），释放
// 旧 doc 的 Y.Doc；registry doc 常驻，永不 drop。

import type { Setter } from 'solid-js';
import * as H from '@/shared/protocol/client';
import type { DocStore } from '@/shared/yjs/doc-store';
import { reconcileRuntimeControl } from '@/features/runtime/runtime-control';
import { isTerminal, isTurnActive } from '@/features/runtime/action-state';
import { resetMcpState } from '@/features/mcp/mcp';
import { tearDownMcpAppsForChat } from '@/features/mcp/mcp-apps';
import { resetRewindState } from '@/features/runtime/rewind-assembly';
import type { ChatEntry } from '@/entities/chat/chat-view';
import type { ControlView } from '@/entities/chat/control-view';
import { resetElicitationResponses } from '@/features/message/elicitation-delivery';
import { resetQuestionResponses } from '@/features/message/question-delivery';

export interface ChatSubscriptionDeps {
  /** 选中对话（重连后恢复订阅）；状态归 store 组合根所有。 */
  getCurrentCid: () => string | null;
  setCurrentCid: (cid: string | null) => void;
  /** 组合根的 DocStore 实例：切换时 drop 旧 doc（registry doc 永不 drop）。 */
  docStore: DocStore;
  sendFrame: (frame: unknown) => boolean;
  toast: (msg: string) => void;
  /** 各 chat 的运行时状态（终态判定；reconcileCurrentRuntimeControl 需要）。 */
  chatStatusSignal: () => Record<string, string>;
  /** 当前会话的控制头（reconcileCurrentRuntimeControl 缺省参数读取）。 */
  chatHead: () => ControlView | null;
  setSelectedCid: (cid: string | null) => void;
  setChatEntries: (entries: ChatEntry[]) => void;
  setChatHead: (head: ControlView | null) => void;
  setPermissions: (permissions: ControlView['pendingPermissions']) => void;
  setElicitations: (items: NonNullable<ControlView['pendingElicitations']>) => void;
  setQuestions: (items: NonNullable<ControlView['pendingQuestions']>) => void;
  setRuntimeDocsState: Setter<{ chat: boolean; control: boolean }>;
}

let deps: ChatSubscriptionDeps | null = null;

/** store 组合根装配入口：注入来自 store 的运行时依赖（须在使用前调用一次）。 */
export function installChatSubscription(d: ChatSubscriptionDeps): void {
  deps = d;
}

/** 订阅集合：registry 常驻 + 当前对话（chat + control 双 doc）。 */
function desiredDocs(): string[] {
  const docs = [H.DOC_REGISTRY];
  const currentCid = deps!.getCurrentCid();
  if (currentCid) {
    docs.push(H.chatDoc(currentCid));
    docs.push(H.sessionDoc(currentCid));
  }
  return docs;
}

/** 订阅重放（首次连接与断线重连共用；ysync.subscribe 幂等）。 */
export function sendSubscribe(): void {
  if (!deps!.sendFrame(H.subscribe(desiredDocs()))) {
    deps!.toast('Connection not ready, subscription failed');
  }
}

export function reconcileCurrentRuntimeControl(control: ControlView | null = deps!.chatHead()): void {
  const currentCid = deps!.getCurrentCid();
  if (!currentCid) return;
  reconcileRuntimeControl(
    currentCid,
    isTurnActive(control?.activeTurn),
    isTerminal(deps!.chatStatusSignal()[currentCid]),
  );
}

export function selectChat(cid: string): void {
  const previousCid = deps!.getCurrentCid();
  if (cid === previousCid) return;
  if (previousCid) {
    deps!.sendFrame(H.unsubscribe([H.chatDoc(previousCid), H.sessionDoc(previousCid)]));
    // 先退订后 drop（WebSocket 顺序保证）：释放旧 doc 的 Y.Doc 生命周期。
    // registry doc 常驻，永不 drop。
    deps!.docStore.drop(H.chatDoc(previousCid));
    deps!.docStore.drop(H.sessionDoc(previousCid));
  }
  deps!.setCurrentCid(cid);
  deps!.setSelectedCid(cid);
  sendSubscribe(); // unsubscribe/subscribe 按 WebSocket 顺序生效，快照到达后渲染
  // Runtime docs switch only after the logical session activation commits.
  deps!.setChatEntries([]);
  deps!.setChatHead(null);
  deps!.setPermissions([]);
  deps!.setElicitations([]);
  deps!.setQuestions([]);
  resetElicitationResponses();
  resetQuestionResponses();
  deps!.setRuntimeDocsState({ chat: false, control: false });
  resetMcpState();
  tearDownMcpAppsForChat(previousCid);
  resetRewindState();
}

/** 丢弃并重取当前 Control Doc；只对账原回答，不创建新业务命令。 */
export function refreshCurrentControlProjection(): boolean {
  const currentCid = deps!.getCurrentCid();
  if (!currentCid) return false;
  const docId = H.sessionDoc(currentCid);
  deps!.sendFrame(H.unsubscribe([docId]));
  deps!.docStore.drop(docId);
  deps!.setChatHead(null);
  deps!.setPermissions([]);
  deps!.setElicitations([]);
  deps!.setQuestions([]);
  deps!.setRuntimeDocsState((state) => ({ ...state, control: false }));
  const sent = deps!.sendFrame(H.subscribe([docId]));
  if (!sent) deps!.toast('Connection not ready, question status will refresh after reconnect');
  return sent;
}
