// peri-studio Web 面板 —— 装配与编排（SolidJS 响应式 store）。
//
// 流程（M3 方案 §4，移植自原 main.js）：
//   1. HttpOnly Cookie 鉴权 → ysync.subscribe ["hub:registry"]
//      → 快照 + ready → UI 启用。
//   2. registry 渲染 → 左栏实例/对话。
//   3. 点击对话 → subscribe ["chat:{cid}","session:{cid}"] → 快照渲染历史
//      → 增量实时更新（yjs 流式）。
//   4. 发送消息 → chat/prompt（CommandTracker 跟踪 accepted→terminal）;
//      用户消息依赖 server 投影，本地只保留可恢复的提交状态。
//   5. create committed ack（带 chatId）→ 自动订阅 chat:{cid} 并选中。
//   6. 断线：4500/4501/4502 停止并提示；1011/1013 指数退避重连（ws-client），
//      重连后重放订阅（快照兜底）。

import { createSignal } from 'solid-js';
import * as H from './lib/protocol';
import { DocStore } from './lib/doc-store';
import type { ChatEntry } from './lib/chat-view';
import type { ControlView } from './lib/control-view';
import type { ChatInfo, InstanceInfo, ProjectInfo, ProjectSessionInfo, SessionSummaryInfo } from './lib/registry-view';
import { isTerminal, isTurnActive } from './lib/action-state.ts';
import { CommandTracker } from './lib/command-tracker';
import { SessionActivation, type OpeningSession, type OpenSessionCallbacks } from './lib/session-activation';
import { installPrincipalRole, publishAuthInvalidation, readOnly } from './lib/auth-state';
import { completeMessageDelivery, messageSubmission, resetMessageDelivery } from './lib/message-delivery';
import { settleLateQuickStart } from './lib/quick-start-delivery';
import { confirmRuntimeControl, resetRuntimeControls } from './lib/runtime-control';
import { resetPermissionDecisions } from './lib/permission-delivery';
import { CatalogActions } from './lib/catalog-actions';
import { ToastStore } from './lib/toast-store';
import { ACK_TIMEOUT_MS, type Ack, type ActionError, type ActionFrame, type ActionOptions } from './lib/action-contract';
import { handleMcpOAuth, handleMcpOAuthAuthorization, handleMcpServers, resetMcpState } from './lib/mcp';
import { handleRewindCandidates, handleRewindPreview, resetRewindState, rewindOwnsError } from './lib/rewind-assembly';
import { clearPromptRecoverySelection, handlePromptStatus, promptRecoveryOwnsError, requestPromptRecovery, resetPromptRecoveryState } from './lib/prompt-recovery-assembly';
import { connectionReady, disconnect, forgetRememberedSession, installConnection, readRememberedSession, rememberSession, resetConnectionState, sendFrame } from './lib/connection';
import { ERROR_REASONS, persistActionProblem, reportTransportIssue, type PersistentError } from './lib/panel-errors';
import { sendMessage, type SessionConfigMutation } from './lib/user-actions';
import { installChatSubscription, reconcileCurrentRuntimeControl, selectChat, sendSubscribe } from './lib/chat-subscription';
import { installStoreWiring } from './lib/store-installs';
import { installStoreProjection, type RuntimeDocsState } from './lib/store-projection';
import {
  handleResourceResult,
  handleResourceUpdate,
  installResourceStore,
  replayResourceSubscriptions,
  resetResourceProject,
} from './lib/resource-store';

// ── UI 信号（组件消费）─────────────────────────────────────────────────

export const [selectedCid, setSelectedCid] = createSignal<string | null>(null);
export const [chatEntries, setChatEntries] = createSignal<ChatEntry[]>([]);
export const [chatHead, setChatHead] = createSignal<ControlView | null>(null);
export const [permissions, setPermissions] = createSignal<ControlView['pendingPermissions']>([]);
export const [elicitations, setElicitations] = createSignal<NonNullable<ControlView['pendingElicitations']>>([]);
export const [elicitationResponses, setElicitationResponses] = createSignal<Record<string, string>>({});
export const [projects, setProjects] = createSignal<ProjectInfo[]>([]);
export const [registryHydrated, setRegistryHydrated] = createSignal(false);
export const [projectSessions, setProjectSessions] = createSignal<ProjectSessionInfo[]>([]);
export const [importableSessions, setImportableSessions] = createSignal<SessionSummaryInfo[]>([]);
/** registry 投影的实例清单（拓扑面板只读消费；由 server 权威维护状态）。 */
export const [instances, setInstances] = createSignal<InstanceInfo[]>([]);
/** registry 投影的 chat 目录（拓扑面板按 instance_id 分组展示）。 */
export const [chatCatalog, setChatCatalog] = createSignal<ChatInfo[]>([]);
/** registry 投影的 server 全局健康状态（healthy|degraded|restarting）。 */
export const [globalStatus, setGlobalStatus] = createSignal<string>('unknown');
/** registry 投影的 schema 版本（拓扑/关于面板展示）。 */
export const [schemaVersion, setSchemaVersion] = createSignal<unknown>(null);
export const [selectedSessionId, setSelectedSessionId] = createSignal<string | null>(null);
export const [openingSession, setOpeningSession] = createSignal<OpeningSession | null>(null);
export const openingSessionId = () => openingSession()?.sessionId ?? null;
export type { RuntimeDocsState };
export const [runtimeDocsState, setRuntimeDocsState] = createSignal<RuntimeDocsState>({ chat: false, control: false });
export const runtimeDocsHydrated = () => runtimeDocsState().chat && runtimeDocsState().control;
/** 各 chat 的运行时状态（终态判定；selectChat 需要当前 status）。 */
export const [chatStatusSignal, setChatStatusSignal] = createSignal<Record<string, string>>({});
const toastStore = new ToastStore();
export const toasts = toastStore.records;
export const [persistentErrors, setPersistentErrors] = createSignal<PersistentError[]>([]);
export const turnActive = () => isTurnActive(chatHead()?.activeTurn);
export const [restoringSessionId, setRestoringSessionId] = createSignal<string | null>(null);
export const [creatingSessionProjectId, setCreatingSessionProjectId] = createSignal<string | null>(null);
export const [discoveringSessionsProjectId, setDiscoveringSessionsProjectId] = createSignal<string | null>(null);
export type { PromptRecoveryView } from './lib/prompt-recovery';
export const [sessionConfigMutation, setSessionConfigMutation] = createSignal<SessionConfigMutation | null>(null);

// ── 内部状态 ────────────────────────────────────────────────────────────

const store = new DocStore(); // docId → Y.Doc
let currentCid: string | null = null; // 选中对话（重连后恢复订阅）
const [uncertainMetadataCount, setUncertainMetadataCount] = createSignal(0);

const commands = new CommandTracker<ActionFrame, Ack, ActionError>({
  timeoutMs: ACK_TIMEOUT_MS,
  onUncertainCountChange: setUncertainMetadataCount,
  onFallbackUncertain: (request, reason) => persistActionProblem(
    'Result not yet confirmed',
    reason === 'disconnect'
      ? `${request.label} did not receive a terminal reply before the connection dropped. The server may still complete the operation; wait for state sync instead of blindly retrying.`
      : `${request.label} did not receive a terminal reply within 30 seconds. The server may still complete the operation; wait for state sync instead of blindly retrying.`,
    request.frame.commandId,
  ),
});

// ── toast ───────────────────────────────────────────────────────────────

export function toast(msg: string): void {
  toastStore.show(msg);
}

// ── 订阅集合与对话选择（P1 拆分）─────────────────────────────────────
// 订阅集/重连重放/选择切换在 lib/chat-subscription；currentCid 与 UI
// 信号仍归本模块，经 installChatSubscription 注入（模块不反向依赖）。
installChatSubscription({
  getCurrentCid: () => currentCid,
  setCurrentCid: (cid) => { currentCid = cid; },
  docStore: store,
  sendFrame,
  toast,
  chatStatusSignal,
  chatHead,
  setSelectedCid,
  setChatEntries,
  setChatHead,
  setPermissions,
  setElicitations,
  setElicitationResponses,
  setRuntimeDocsState,
});

// isTerminal 与 isTurnActive 同在 lib/action-state（P1 迁移）；此处
// re-export 保持组件与旧调用点的导入路径兼容。
export { isTerminal };

// ── ack 表 ──────────────────────────────────────────────────────────────

// 发送 action 并登记 ack 回调；ready 前不发（server 会缓冲，但面板
// 以 ready 门控保证可预期）。
function sendAction(frame: ActionFrame, label: string, options: ActionOptions = {}): boolean {
  const result = commands.dispatch({
    frame,
    label,
    callbacks: {
      onAccepted: options.onAccepted,
      onTerminal: options.cb,
      onError: options.onError,
      retryOnUncertain: options.retryOnUncertain,
      retryOnError: options.retryOnError,
      onUncertain: options.onTimeout,
    },
  }, sendFrame);
  if (result !== 'sent') {
    if (result === 'already_pending') return false;
    toast(`Connection not ready, cannot send ${label}`);
    options.onError?.({ commandId: frame.commandId, code: 'UNAVAILABLE', message: 'Connection not ready', retryable: true });
    return false;
  }
  return true;
}

// 特性装配（P1 拆分）：面板错误/用户动作/MCP/Rewind/PromptRecovery
// 五个 install 迁至 lib/store-installs，运行时依赖一次注入。
installStoreWiring({
  setPersistentErrors,
  hasUncertain: (commandId) => commands.hasUncertain(commandId),
  forget: (commandId) => commands.forget(commandId),
  hasPending: (commandId) => commands.hasPending(commandId),
  retry: (commandId) => commands.retry(commandId, sendFrame),
  toast,
  selectedCid,
  openingSessionId,
  turnActive,
  currentCid: () => currentCid,
  selectedSessionId,
  chatStatusSignal,
  chatHead,
  sessionConfigMutation,
  setSessionConfigMutation,
  elicitationResponses,
  setElicitationResponses,
  sendAction,
  reconcileCurrentRuntimeControl,
  acknowledge: (ack) => commands.acknowledge(ack),
  fail: (err) => commands.fail(err),
});

// 身份失效处理：先整体复位身份边界，再通知 AuthGate 切换登录态。
function invalidateAuthentication(reason: string): void {
  resetAuthenticatedSession();
  publishAuthInvalidation(reason);
}

// 连接装配（P3 拆分）：ws 生命周期与状态回调在 lib/connection，业务
// 回调经 installConnection 注入回组合根。
installConnection({
  settleConnectionLoss: () => commands.settleConnectionLoss(),
  onConnectionLost: () => sessionActivation.connectionLost(),
  onAuthInvalidation: invalidateAuthentication,
  toast,
  sendSubscribe,
  onReady: () => {
    replayResourceSubscriptions();
    if (registryHydrated()) reconcileSessionNavigation(projectSessions());
    if (selectedSessionId()) requestPromptRecovery(selectedSessionId()!);
  },
  onFrame,
  onProtocolIssue: reportTransportIssue,
});

// ── 下行帧分发 ──────────────────────────────────────────────────────────

function onFrame(frame: H.DownstreamFrame): void {
  switch (frame.t) {
    case 'ysync.update':
      if (!handleResourceUpdate(frame as { doc: string; update: string })) {
        store.applyUpdateFrame(frame as { doc: string; update: string });
      }
      break;
    case 'resource_result':
      handleResourceResult(frame as import('./lib/resource-protocol').ResourceResultFrame);
      break;
    case 'action_ack':
      onAck(frame as Ack);
      break;
    case 'action_error':
      onActionError(frame as ActionError);
      break;
    case 'prompt_status':
      handlePromptStatus(frame);
      break;
    case 'rewind_candidates':
      handleRewindCandidates(frame);
      break;
    case 'rewind_preview':
      handleRewindPreview(frame);
      break;
    case 'mcp_servers':
      handleMcpServers(frame);
      break;
    case 'mcp_oauth':
      handleMcpOAuth(frame);
      break;
    case 'mcp_oauth_authorization':
      handleMcpOAuthAuthorization(frame);
      break;
    case 'auth_error':
      invalidateAuthentication('Access token is invalid, revoked, or the server restarted. Please sign in again.');
      break;
    default:
      break; // 未知帧忽略（协议演进兼容）
  }
}

function onAck(ack: Ack): void {
  const disposition = commands.acknowledge(ack);
  // A terminal acknowledgement that arrives after timeout/disconnect can
  // reconcile local uncertainty, but must not replay an expired continuation.
  if (disposition === 'late_terminal') {
    const completedSubmission = messageSubmission();
    if (completedSubmission && ack.commandId) completeMessageDelivery(ack.commandId, ack.status);
    if (ack.commandId) settleLateQuickStart(ack.commandId, ack.status, ack.sessionId, ack.chatId);
    if (ack.commandId && confirmRuntimeControl(ack.commandId, ack.status)) reconcileCurrentRuntimeControl();
  }
  if (ack.status !== 'accepted' && ack.commandId) {
    setPersistentErrors((items) => items.filter((item) => item.commandId !== ack.commandId));
  }
}

function onActionError(err: ActionError): void {
  if (promptRecoveryOwnsError(err)) return;
  if (rewindOwnsError(err)) return;
  console.error(`[panel] action error code=${err.code || 'UNKNOWN'} command=${err.commandId ? 'present' : 'absent'}`);
  commands.fail(err);
  const reason = err.code ? ERROR_REASONS[err.code] : undefined;
  persistActionProblem(reason || err.code || 'Operation failed', err.message || 'The server provided no further information.', err.commandId);
}

function clearCurrentSelection(): void {
  clearPromptRecoverySelection();
  setSelectedSessionId(null);
  const previousCid = currentCid;
  if (previousCid) {
    sendFrame(H.unsubscribe([H.chatDoc(previousCid), H.sessionDoc(previousCid)]));
    // 先退订后 drop（WebSocket 顺序保证）：释放旧 doc 的 Y.Doc 生命周期。
    // registry doc 常驻，永不 drop。
    store.drop(H.chatDoc(previousCid));
    store.drop(H.sessionDoc(previousCid));
  }
  currentCid = null;
  setSelectedCid(null);
  setChatEntries([]);
  setChatHead(null);
  setPermissions([]);
  setElicitations([]);
  setElicitationResponses({});
  setRuntimeDocsState({ chat: false, control: false });
  resetMcpState();
  resetRewindState();
  forgetRememberedSession();
}

function activateSession(sessionId: string, chatId: string): void {
  setSelectedSessionId(sessionId);
  rememberSession(sessionId);
  selectChat(chatId);
  requestPromptRecovery(sessionId);
}

const sessionActivation = new SessionActivation({
  isReady: connectionReady,
  isReadOnly: readOnly,
  hasUncertainMetadata: () => !!uncertainMetadataCount(),
  hasMessageSubmission: () => !!messageSubmission(),
  creatingProjectId: creatingSessionProjectId,
  setCreatingProjectId: setCreatingSessionProjectId,
  sessions: projectSessions,
  selectedSessionId,
  currentChatId: () => currentCid,
  preferredSessionId: readRememberedSession,
  send: sendAction,
  retry: (commandId) => commands.retry(commandId, sendFrame) ?? 'missing',
  hasUncertainCommand: (commandId) => commands.hasUncertain(commandId),
  activate: activateSession,
  forgetPreference: forgetRememberedSession,
  sendFirstMessage: (text) => sendMessage(text),
  onNavigationChange: (snapshot) => {
    setOpeningSession(snapshot.opening);
    setRestoringSessionId(snapshot.restoringSessionId);
  },
  toast,
  persistProblem: persistActionProblem,
});

function reconcileSessionNavigation(sessions: ProjectSessionInfo[]): void {
  sessionActivation.reconcileCatalog(sessions);
}

installStoreProjection(
  store,
  () => currentCid,
  {
    setChatEntries,
    setChatHead,
    setPermissions,
    setElicitations,
    setElicitationResponses,
    setProjects,
    setRegistryHydrated,
    setProjectSessions,
    setImportableSessions,
    setInstances,
    setChatCatalog,
    setGlobalStatus,
    setSchemaVersion,
    setChatStatusSignal,
    setRuntimeDocsState,
  },
  reconcileSessionNavigation,
  reconcileCurrentRuntimeControl,
);

const catalogActions = new CatalogActions({
  isReady: connectionReady,
  isReadOnly: readOnly,
  hasUncertainMetadata: () => !!uncertainMetadataCount(),
  send: sendAction,
  toast,
  persistProblem: persistActionProblem,
  onProjectArchived: (projectId) => {
    const selected = projectSessions().find((session) => session.id === selectedSessionId());
    if (selected?.projectId === projectId) clearCurrentSelection();
  },
  onSessionArchived: (sessionId) => {
    if (selectedSessionId() === sessionId) clearCurrentSelection();
  },
  discoveringProjectId: discoveringSessionsProjectId,
  setDiscoveringProjectId: setDiscoveringSessionsProjectId,
});

export const createProject = (name: string, cwd: string, onCommitted?: () => void, onFailed?: () => void) =>
  catalogActions.createProject(name, cwd, { onCommitted, onFailed });
export const archiveProject = (projectId: string, onCommitted?: () => void, onFailed?: () => void) =>
  catalogActions.archiveProject(projectId, { onCommitted, onFailed });
export const restoreProject = (projectId: string, onCommitted?: () => void, onFailed?: () => void) =>
  catalogActions.restoreProject(projectId, { onCommitted, onFailed });
export const renameProject = (projectId: string, name: string, onCommitted?: () => void, onFailed?: () => void) =>
  catalogActions.renameProject(projectId, name, { onCommitted, onFailed });

export const createProjectSession = (projectId: string, title?: string): boolean => sessionActivation.create(projectId, title);
export const createSessionWithFirstMessage = (projectId: string, text: string): boolean => sessionActivation.quickStart(projectId, text);
export const retryQuickStart = (): void => sessionActivation.retryQuickStart();

export const renameProjectSession = (sessionId: string, name: string, onCommitted?: () => void, onFailed?: () => void) =>
  catalogActions.renameSession(sessionId, name, { onCommitted, onFailed });
export const archiveProjectSession = (sessionId: string, onCommitted?: () => void, onFailed?: () => void) =>
  catalogActions.setSessionArchived(sessionId, true, { onCommitted, onFailed });
export const restoreProjectSession = (sessionId: string, onCommitted?: () => void, onFailed?: () => void) =>
  catalogActions.setSessionArchived(sessionId, false, { onCommitted, onFailed });
export const importProjectSession = (projectId: string, acpSessionId: string, onCommitted?: () => void, onFailed?: (kind: 'failed' | 'uncertain') => void) =>
  catalogActions.importSession(projectId, acpSessionId, onCommitted, onFailed);
export const discoverProjectSessions = (projectId: string, onCommitted?: () => void, onFailed?: (message: string) => void) =>
  catalogActions.discoverSessions(projectId, onCommitted, onFailed);

export function resetAuthenticatedSession(): void {
  // Revoke mutation authority before settling callbacks from the old transport.
  // This function is intentionally idempotent: both the invalidation producer
  // and AuthGate consumer call it to make the identity boundary fail closed.
  installPrincipalRole(null);
  disconnect();
  resetConnectionState();
  currentCid = null;
  setSelectedCid(null);
  setSelectedSessionId(null);
  setChatEntries([]);
  setChatHead(null);
  setPermissions([]);
  setElicitations([]);
  setElicitationResponses({});
  setRuntimeDocsState({ chat: false, control: false });
  setChatStatusSignal({});
  setProjects([]);
  setProjectSessions([]);
  setImportableSessions([]);
  resetPromptRecoveryState();
  resetMessageDelivery();
  sessionActivation.reset();
  resetRuntimeControls();
  setSessionConfigMutation(null);
  resetRewindState();
  setDiscoveringSessionsProjectId(null);
  setPersistentErrors([]);
  commands.reset();
  resetPermissionDecisions();
  setRegistryHydrated(false);
  store.clear();
  resetResourceProject();
  // Keep this last: disconnect/reset callbacks are allowed to publish feedback,
  // but no notification from the previous principal may survive this boundary.
  toastStore.clear();
}

export function navigateProjectSession(sessionId: string, callbacks: OpenSessionCallbacks = {}): boolean {
  return sessionActivation.navigate(sessionId, callbacks);
}

// ── 装配 ────────────────────────────────────────────────────────────────

// Browser UI authenticates through AuthGate and an HttpOnly cookie. The
// remembered token lives in localStorage (peri_studio_token) and is replayed by
// AuthGate only; the session itself is never recovered from Web Storage here.

// P1 拆分：以下符号迁至 lib/panel-errors 与 lib/user-actions，此处
// re-export 保持组件与旧调用点的导入路径不变。
export { selectChat };
export {
  dismissPersistentError,
  reportTransportIssue,
  retryPersistentAction,
  retainPersistentErrors,
} from './lib/panel-errors';
export {
  retryMessageSubmission,
  cancelTurn,
  setSessionConfig,
  retrySessionConfigMutation,
  closeChat,
  resolvePermission,
  respondElicitation,
} from './lib/user-actions';
export { sendMessage };
export type { PersistentError } from './lib/panel-errors';
export type { SessionConfigMutation } from './lib/user-actions';

installResourceStore({ send: sendFrame, ready: connectionReady, toast });
export {
  activateResourceProject,
  closeResourceFilePreview,
  downloadResourceFile,
  downloadPreviewedFile,
  closeResourceDiffPreview,
  mutateGitResource,
  retryGitRepositoryMutation,
  retryGitResourceMutation,
  openGitDiffPreview,
  openFilePreview,
  openMoreGitChanges,
  openResourceDirectory,
  refreshResourceProject,
  resourceFilePreview,
  retryGitDiffPreview,
  retryResourceFilePreview,
  resourceDiffPreview,
  resourceWorkspace,
} from './lib/resource-store';
