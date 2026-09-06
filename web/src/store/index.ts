// peri-studio Web 面板组合根：装配协议、投影与领域控制器。

import { createSignal, createEffect } from 'solid-js';
import * as H from '../panel/lib/protocol';
import { DocStore } from '../panel/lib/doc-store';
import type { ChatEntry } from '@/entities/chat/chat-view';
import type { ControlView } from '@/entities/chat/control-view';
import type { ChatInfo, InstanceInfo, ProjectInfo, ProjectSessionInfo, SessionSummaryInfo } from '@/entities/registry/registry-view';
import { isTerminal, isTurnActive } from '../panel/lib/action-state.ts';
import { CommandTracker } from '../panel/lib/command-tracker';
import { SessionActivation, type OpeningSession, type OpenSessionCallbacks } from '@/features/session/session-activation';
import { installPrincipalRole, principalId, publishAuthInvalidation, readOnly } from '../panel/lib/auth-state';
import { setComposerDraft } from '@/features/composer/composer-draft';
import { completeMessageDelivery, messageSubmission, messageSubmissionForChat, ownsMessageDeliveryError, resetMessageDelivery, settleProjectedMessageDelivery } from '../panel/lib/message-delivery';
import { settleLateQuickStart } from '../panel/lib/quick-start-delivery';
import { confirmRuntimeControl, resetRuntimeControls } from '../panel/lib/runtime-control';
import { resetPermissionDecisions } from '../panel/lib/permission-delivery';
import { CatalogActions } from '@/features/catalog/catalog-actions';
import { createSessionCatalogBootstrap } from '@/features/catalog/session-catalog-bootstrap';
import { selectActiveProjects } from '@/features/catalog/project-catalog';
import { ToastStore } from '../panel/lib/toast-store';
import { ACK_TIMEOUT_MS, type Ack, type ActionError, type ActionFrame, type ActionOptions } from '../panel/lib/action-contract';
import { handleMcpOAuth, handleMcpOAuthAuthorization, handleMcpServers, resetMcpState } from '../panel/lib/mcp';
import {
  handleMcpAppCallResult,
  handleMcpAppResource,
  handleMcpAppSession,
  ownsMcpAppsError,
  resetMcpAppsState,
} from '../panel/lib/mcp-apps';
import { handleRewindCandidates, handleRewindPreview, resetRewindState, rewindOwnsError } from '../panel/lib/rewind-assembly';
import { clearPromptRecoverySelection, handlePromptStatus, promptRecoveryOwnsError, requestPromptRecovery, resetPromptRecoveryState } from '../panel/lib/prompt-recovery-assembly';
import { handleTerminalConnectionLost, handleTerminalFrame, installTerminalTransport, resetTerminalSession } from '@/features/terminal/terminal-session';
import type { TerminalDownstreamFrame } from '@/shared/protocol/terminal';
import { connectionReady, disconnect, forgetRememberedSession, installConnection, promptMaxBytes, readRememberedSession, rememberSession, resetConnectionState, sendFrame } from '../panel/lib/connection';
import { ERROR_REASONS, persistActionProblem, reportTransportIssue, type PersistentError } from '../panel/lib/panel-errors';
import { sendMessage, type SessionConfigMutation } from '../panel/lib/user-actions';
import { installChatSubscription, reconcileCurrentRuntimeControl, refreshCurrentControlProjection, selectChat, sendSubscribe } from '../panel/lib/chat-subscription';
import { installStoreWiring } from '../panel/lib/store-installs';
import { installStoreProjection, type RuntimeDocsState } from '../panel/lib/store-projection';
import { elicitationResponses, resetElicitationResponses } from '../panel/lib/elicitation-delivery';
import {
  handleResourceResult,
  handleResourceUpdate,
  installResourceStore,
  replayResourceSubscriptions,
  resetResourceProject,
} from '../panel/lib/resource-store';

export const [selectedCid, setSelectedCid] = createSignal<string | null>(null);
export { connectionReady, readOnly };
export const [chatEntries, setChatEntries] = createSignal<ChatEntry[]>([]);
export const [chatHead, setChatHead] = createSignal<ControlView | null>(null);
export const [permissions, setPermissions] = createSignal<ControlView['pendingPermissions']>([]);
export const [elicitations, setElicitations] = createSignal<NonNullable<ControlView['pendingElicitations']>>([]);
export { elicitationResponses };
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
let scheduleSessionCatalogBootstrap: () => void = () => {};
let sessionCatalogBootstrap: ReturnType<typeof createSessionCatalogBootstrap> | null = null;
export function isProjectCatalogBootstrapPending(projectId: string): boolean {
  return sessionCatalogBootstrap?.pending().has(projectId) ?? false;
}
export type { PromptRecoveryView } from '../panel/lib/prompt-recovery';
export const [sessionConfigMutation, setSessionConfigMutation] = createSignal<SessionConfigMutation | null>(null);

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
  setRuntimeDocsState,
});

// isTerminal 与 isTurnActive 同在 lib/action-state（P1 迁移）；此处
// re-export 保持组件与旧调用点的导入路径兼容。
export { isTerminal };

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
      acceptedStartsInactivityLease: options.acceptedStartsInactivityLease,
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
  composerDraftOwner: () => {
    const sessionId = selectedSessionId();
    const identity = principalId();
    const projectId = projectSessions().find((session) => session.id === sessionId)?.projectId;
    return identity && projectId && sessionId ? { principalId: identity, projectId, sessionId } : null;
  },
  chatStatusSignal,
  chatHead,
  sessionConfigMutation,
  setSessionConfigMutation,
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

// Terminal 与 chat/Yjs/resource 独立；这里只注入复用的认证 WebSocket。
installTerminalTransport({ send: sendFrame, ready: connectionReady });

// 连接装配（P3 拆分）：ws 生命周期与状态回调在 lib/connection，业务
// 回调经 installConnection 注入回组合根。
installConnection({
  settleConnectionLoss: () => commands.settleConnectionLoss(),
  onConnectionLost: () => {
    sessionCatalogBootstrap?.reset();
    sessionActivation.connectionLost();
    handleTerminalConnectionLost();
  },
  onAuthInvalidation: invalidateAuthentication,
  toast,
  sendSubscribe,
  onReady: () => {
    replayResourceSubscriptions();
    // Server restart drops in-memory runtime chat docs; resubscribe alone is not
    // enough — re-open the selected logical session so the server can spawn/load
    // or resume the correct runtime chat instead of accepting prompts on a stale id.
    sessionActivation.reactivateAfterReconnect();
    if (!selectedSessionId() && registryHydrated()) reconcileSessionNavigation(projectSessions());
    scheduleSessionCatalogBootstrap();
    const sessionId = selectedSessionId();
    if (sessionId) requestPromptRecovery(sessionId);
  },
  onFrame,
  onProtocolIssue: reportTransportIssue,
});

function onFrame(frame: H.DownstreamFrame): void {
  switch (frame.t) {
    case 'ysync.update':
      if (!handleResourceUpdate(frame as { doc: string; update: string })) {
        store.applyUpdateFrame(frame as { doc: string; update: string });
      }
      break;
    case 'resource_result':
      handleResourceResult(frame as import('../panel/lib/resource-protocol').ResourceResultFrame);
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
    case 'mcp_app_session':
      handleMcpAppSession(frame);
      break;
    case 'mcp_app_resource':
      handleMcpAppResource(frame);
      break;
    case 'mcp_app_call_result':
      handleMcpAppCallResult(frame);
      break;
    case 'terminal_opened':
      handleTerminalFrame(frame as TerminalDownstreamFrame);
      break;
    case 'terminal_output':
      handleTerminalFrame(frame as TerminalDownstreamFrame);
      break;
    case 'terminal_exit':
      handleTerminalFrame(frame as TerminalDownstreamFrame);
      break;
    case 'terminal_error':
      handleTerminalFrame(frame as TerminalDownstreamFrame);
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
    if (ack.commandId) completeMessageDelivery(ack.commandId, ack.status);
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
  if (ownsMcpAppsError(err)) return;
  console.error(`[panel] action error code=${err.code || 'UNKNOWN'} command=${err.commandId ? 'present' : 'absent'}`);
  const messageDeliveryOwnsError = ownsMessageDeliveryError(err.commandId, err.code);
  commands.fail(err);
  settleProjectedMessageDelivery(err.commandId);
  if (messageDeliveryOwnsError) return;
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
  resetElicitationResponses();
  setRuntimeDocsState({ chat: false, control: false });
  resetMcpState();
  resetMcpAppsState();
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
  hasMessageSubmission: () => !!messageSubmission(selectedSessionId()),
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
  preserveFirstMessage: (projectId, sessionId, text) => {
    const identity = principalId();
    if (!identity) return false;
    setComposerDraft({ principalId: identity, projectId, sessionId }, text);
    return true;
  },
  maxPromptBytes: promptMaxBytes,
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
  (chatId) => {
    const submission = messageSubmissionForChat(chatId);
    if (submission?.chatId === chatId) commands.touch(submission.commandId);
  },
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

sessionCatalogBootstrap = createSessionCatalogBootstrap({
  isReady: connectionReady,
  isReadOnly: readOnly,
  activeProjectIds: () => selectActiveProjects(projects()).map((project) => project.id),
  discover: (projectId, onSettled) => {
    return catalogActions.discoverSessions(projectId, onSettled, onSettled);
  },
});
scheduleSessionCatalogBootstrap = () => sessionCatalogBootstrap?.schedule();

createEffect(() => {
  const ready = connectionReady();
  const hydrated = registryHydrated();
  if (ready && hydrated) scheduleSessionCatalogBootstrap();
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

export function resetAuthenticatedSession(options: { preserveLocalDrafts?: boolean } = {}): void {
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
  resetElicitationResponses();
  setRuntimeDocsState({ chat: false, control: false });
  setChatStatusSignal({});
  setProjects([]);
  setProjectSessions([]);
  setImportableSessions([]);
  resetPromptRecoveryState();
  resetMessageDelivery(options.preserveLocalDrafts === true);
  sessionActivation.reset();
  resetRuntimeControls();
  setSessionConfigMutation(null);
  resetRewindState();
  resetTerminalSession();
  setDiscoveringSessionsProjectId(null);
  sessionCatalogBootstrap?.reset();
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

// Browser UI authenticates through AuthGate and an HttpOnly cookie. The
// remembered token lives in localStorage (peri_studio_token) and is replayed by
// AuthGate only; the session itself is never recovered from Web Storage here.

// P1 拆分：以下符号迁至 lib/panel-errors 与 lib/user-actions，此处
// re-export 保持组件与旧调用点的导入路径不变。
export { refreshCurrentControlProjection, selectChat };
export {
  dismissPersistentError,
  reportTransportIssue,
  retryPersistentAction,
  retainPersistentErrors,
} from '../panel/lib/panel-errors';
export {
  retryMessageSubmission,
  cancelTurn,
  setSessionConfig,
  retrySessionConfigMutation,
  closeChat,
  resolvePermission,
  respondElicitation,
} from '../panel/lib/user-actions';
export { sendMessage };
export type { PersistentError } from '../panel/lib/panel-errors';
export type { SessionConfigMutation } from '../panel/lib/user-actions';

installResourceStore({ send: sendFrame, ready: connectionReady, toast });
export {
  activateResourceProject,
  closeResourceFilePreview,
  downloadResourceFile,
  downloadPreviewedFile,
  closeResourceDiffPreview,
  mutateGitResource,
  mutateGitGraphResource,
  retryGitRepositoryMutation,
  retryGitResourceMutation,
  openGitDiffPreview,
  openFilePreview,
  openMoreGitChanges,
  openGitLog,
  openMoreGitLog,
  refreshGitLog,
  gitLogCommits,
  gitLogHeadOid,
  gitLogLoading,
  canLoadMoreGitLog,
  openResourceDirectory,
  refreshResourceProject,
  resourceFilePreview,
  retryGitDiffPreview,
  retryResourceFilePreview,
  resourceDiffPreview,
  resourceWorkspace,
} from '../panel/lib/resource-store';
