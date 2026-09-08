// peri-studio Web 面板组合根：装配协议、投影与领域控制器。

import { createSignal, createEffect, createRoot } from 'solid-js';
import * as H from '@/shared/protocol/client';
import { DocStore } from '@/shared/yjs/doc-store';
import type { ChatEntry } from '@/entities/chat/chat-view';
import type { ControlView } from '@/entities/chat/control-view';
import type { ChatInfo, InstanceInfo, MachineInfo, ProjectInfo, ProjectSessionInfo, SessionSummaryInfo } from '@/entities/registry/registry-view';
import { isTerminal, isTurnActive } from '@/features/runtime/action-state';
import { CommandTracker } from '@/features/connection/command-tracker';
import { SessionActivation, type OpeningSession, type OpenSessionCallbacks } from '@/features/session/session-activation';
import { principalId, publishAuthInvalidation, readOnly } from '@/features/auth/auth-state';
import { setComposerDraft } from '@/features/composer/composer-draft';
import { messageSubmission, messageSubmissionForChat } from '@/features/message/message-delivery';
import { createConnectionDownstream } from '@/features/connection/handle-downstream';
import { createResourceDownstream } from '@/features/resource/handle-downstream';
import { createSessionDownstream } from '@/features/session/handle-downstream';
import { createMcpDownstream } from '@/features/mcp/handle-downstream';
import { createTerminalDownstream } from '@/features/terminal/handle-downstream';
import { createOnFrame } from './downstream';
import { createResetAuthenticatedSession } from './reset-session';
import { CatalogActions } from '@/features/catalog/catalog-actions';
import { MachineActions } from '@/features/machine/machine-actions';
import { createSessionCatalogBootstrap } from '@/features/catalog/session-catalog-bootstrap';
import { selectActiveProjects } from '@/features/catalog/project-catalog';
import { ToastStore } from './toast-store';
import { ACK_TIMEOUT_MS, type Ack, type ActionError, type ActionFrame, type ActionOptions } from '@/shared/protocol/action-contract';
import { resetMcpState } from '@/features/mcp/mcp';
import { resetMcpAppsState } from '@/features/mcp/mcp-apps';
import { resetRewindState } from '@/features/runtime/rewind-assembly';
import { clearPromptRecoverySelection, requestPromptRecovery } from '@/features/runtime/prompt-recovery-assembly';
import { closeTerminalBeforeTeardown, handleTerminalConnectionLost, installTerminalTransport } from '@/features/terminal/terminal-session';
import { connectionReady, forgetRememberedSession, installConnection, promptMaxBytes, readRememberedSession, rememberSession, sendFrame } from '@/features/connection/connection';
import { createRemoteDirectoryBrowsePorts } from '@/features/connection/remote-directory-ports';
import { persistActionProblem, reportTransportIssue, type PersistentError } from '../features/message/panel-errors';
import { sendMessage, type SessionConfigMutation } from '../features/message/user-actions';
import { chatAgentLoading as deriveChatAgentLoading } from '@/features/chat/chat-agent-loading';
import { installChatSubscription, reconcileCurrentRuntimeControl, refreshCurrentControlProjection, selectChat, sendSubscribe } from '@/features/connection/chat-subscription';
import { installStoreWiring } from './store-installs';
import { installStoreProjection, type RuntimeDocsState } from './store-projection';
import { elicitationResponses, resetElicitationResponses } from '@/features/message/elicitation-delivery';
import { questionResponses, resetQuestionResponses } from '@/features/message/question-delivery';
import {
  forwardRemoteDirectoryResourceResult,
  forwardRemoteDirectoryResourceUpdate,
} from '@/features/machine/remote-directory-browse';
import {
  handleResourceResult,
  handleResourceUpdate,
  installResourceStore,
  replayResourceSubscriptions,
  refreshResourceProject,
} from '@/features/resource/resource-store';
import {
  bindWorkspaceUploadActionSender,
  bindWorkspaceUploadExplorerRefresh,
  clearSubmittedWorkspaceUploads,
  createEmptyExplorerFile,
  enqueueComposerRootUpload,
  enqueueExplorerUpload,
  enqueueQuickStartRootUpload,
  explorerCreatedFileFocus,
  forwardWorkspaceUploadActionAck,
  forwardWorkspaceUploadActionError,
  forwardWorkspaceUploadResourceResult,
  markWorkspaceUploadReferenceInjected,
  resetWorkspaceUploadAssembly,
  retryWorkspaceUpload,
  workspaceUploadAvailable,
  workspaceUploadBlockedMessage,
  workspaceUploadBatch,
  workspaceUploadLiveMessage,
  workspaceUploadOrigin,
  workspaceUploadProgressPercent,
  workspaceUploadTileStatus,
} from './workspace-upload';
import {
  bindFsMutationActionSender,
  forwardFsMutationResourceResult,
  installFsMutationCatalog,
} from './fs-mutations';
import { installResourceWorkbenchPorts } from './resource-workbench-request';

export const [selectedCid, setSelectedCid] = createSignal<string | null>(null);
export { connectionReady, readOnly };
export const remoteDirectoryBrowsePorts = createRemoteDirectoryBrowsePorts({
  ready: connectionReady,
  send: sendFrame,
});
export const [chatEntries, setChatEntries] = createSignal<ChatEntry[]>([]);
export const [chatHead, setChatHead] = createSignal<ControlView | null>(null);
export const [permissions, setPermissions] = createSignal<ControlView['pendingPermissions']>([]);
export const [elicitations, setElicitations] = createSignal<NonNullable<ControlView['pendingElicitations']>>([]);
export { elicitationResponses };
export const [questions, setQuestions] = createSignal<NonNullable<ControlView['pendingQuestions']>>([]);
export { questionResponses };
export const [projects, setProjects] = createSignal<ProjectInfo[]>([]);
export const [machines, setMachines] = createSignal<MachineInfo[]>([]);
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
export const chatAgentLoading = () => deriveChatAgentLoading(chatHead()?.chat?.loading, chatHead()?.activeTurn);
export const [restoringSessionId, setRestoringSessionId] = createSignal<string | null>(null);
export const [creatingSessionProjectId, setCreatingSessionProjectId] = createSignal<string | null>(null);
export const [discoveringSessionsProjectId, setDiscoveringSessionsProjectId] = createSignal<string | null>(null);
let scheduleSessionCatalogBootstrap: () => void = () => {};
let sessionCatalogBootstrap: ReturnType<typeof createSessionCatalogBootstrap> | null = null;
export function isProjectCatalogBootstrapPending(projectId: string): boolean {
  return sessionCatalogBootstrap?.pending().has(projectId) ?? false;
}
export type { PromptRecoveryView } from '@/features/runtime/prompt-recovery';
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
  setQuestions,
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

bindWorkspaceUploadActionSender(sendAction);
bindWorkspaceUploadExplorerRefresh(() => refreshResourceProject());
bindFsMutationActionSender(sendAction);
installFsMutationCatalog({ projects, instances });
installResourceWorkbenchPorts({
  projectCwd: () => {
    const sessionId = selectedSessionId();
    const session = projectSessions().find((item) => item.id === sessionId);
    const project = projects().find((item) => item.id === session?.projectId);
    return project?.cwd;
  },
});

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

// Terminal 与 chat/Yjs/resource 独立；这里只注入复用的认证 WebSocket。
installTerminalTransport({ send: sendFrame, ready: connectionReady });

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
  setQuestions([]);
  resetElicitationResponses();
  resetQuestionResponses();
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
    setQuestions,
    setProjects,
    setMachines,
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

const machineActions = new MachineActions({
  isReady: connectionReady,
  isReadOnly: readOnly,
  hasUncertainMetadata: () => !!uncertainMetadataCount(),
  send: sendAction,
  toast,
  persistProblem: persistActionProblem,
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

createRoot(() => {
  createEffect(() => {
    const ready = connectionReady();
    const hydrated = registryHydrated();
    if (ready && hydrated) scheduleSessionCatalogBootstrap();
  });
});

export const resetAuthenticatedSession = createResetAuthenticatedSession({
  setCurrentCid: (cid) => { currentCid = cid; },
  setSelectedCid,
  setSelectedSessionId,
  setChatEntries,
  setChatHead,
  setPermissions,
  setElicitations,
  setQuestions,
  setRuntimeDocsState,
  setChatStatusSignal,
  setProjects,
  setMachines,
  setProjectSessions,
  setImportableSessions,
  setDiscoveringSessionsProjectId,
  setSessionConfigMutation,
  setPersistentErrors,
  setRegistryHydrated,
  sessionActivation,
  sessionCatalogBootstrap: () => sessionCatalogBootstrap,
  commands,
  docStore: store,
  toastStore,
  resetWorkspaceUploadAssembly,
});

// 身份失效处理：先整体复位身份边界，再通知 AuthGate 切换登录态。
function invalidateAuthentication(reason: string): void {
  resetAuthenticatedSession();
  publishAuthInvalidation(reason);
}

const connectionDownstream = createConnectionDownstream({
  forwardWorkspaceUploadActionAck,
  forwardWorkspaceUploadActionError,
  commands,
  reconcileCurrentRuntimeControl,
  setPersistentErrors,
  invalidateAuthentication,
});
const resourceDownstream = createResourceDownstream({
  docStore: store,
  forwardRemoteDirectoryResourceUpdate,
  forwardRemoteDirectoryResourceResult,
  forwardWorkspaceUploadResourceResult,
  forwardFsMutationResourceResult,
  handleResourceUpdate,
  handleResourceResult,
});
const sessionDownstream = createSessionDownstream();
const mcpDownstream = createMcpDownstream();
const terminalDownstream = createTerminalDownstream();
const onFrame = createOnFrame({
  connection: connectionDownstream,
  resource: resourceDownstream,
  session: sessionDownstream,
  mcp: mcpDownstream,
  terminal: terminalDownstream,
});

// 连接装配（P3 拆分）：ws 生命周期与状态回调在 lib/connection，业务
// 回调经 installConnection 注入回组合根。
installConnection({
  settleConnectionLoss: () => commands.settleConnectionLoss(),
  onBeforeDisconnect: closeTerminalBeforeTeardown,
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

export const createProject = (name: string, cwd: string, instanceId?: string, onCommitted?: () => void, onFailed?: () => void) =>
  catalogActions.createProject(name, cwd, instanceId, { onCommitted, onFailed });

export const addComputer = (
  destination: string,
  displayName?: string,
  port?: number,
  identityFile?: string,
  onCommitted?: () => void,
  onFailed?: () => void,
): boolean => machineActions.add(destination, displayName, port, identityFile, { onCommitted, onFailed });

export const connectMachine = (instanceId: string, onCommitted?: () => void, onFailed?: () => void) =>
  machineActions.connect(instanceId, { onCommitted, onFailed });

export const disconnectMachine = (instanceId: string, onCommitted?: () => void, onFailed?: () => void) =>
  machineActions.disconnect(instanceId, { onCommitted, onFailed });

export const stopMachine = (instanceId: string, onCommitted?: () => void, onFailed?: () => void) =>
  machineActions.stop(instanceId, { onCommitted, onFailed });

export const cancelMachine = (instanceId: string, onCommitted?: () => void, onFailed?: () => void) =>
  machineActions.cancel(instanceId, { onCommitted, onFailed });

export const retryMachine = (instanceId: string, onCommitted?: () => void, onFailed?: () => void) =>
  machineActions.retry(instanceId, { onCommitted, onFailed });

export const trustMachineHost = (
  instanceId: string,
  fingerprint: string,
  onCommitted?: () => void,
  onFailed?: () => void,
) => machineActions.trustHost(instanceId, fingerprint, { onCommitted, onFailed });

export const confirmMachineReplace = (
  instanceId: string,
  onCommitted?: () => void,
  onFailed?: () => void,
) => machineActions.confirmReplace(instanceId, { onCommitted, onFailed });

export const renameMachine = (instanceId: string, name: string, onCommitted?: () => void, onFailed?: () => void) =>
  machineActions.rename(instanceId, name, { onCommitted, onFailed });

export const setMachineAutoReconnect = (
  instanceId: string,
  enabled: boolean,
  onCommitted?: () => void,
  onFailed?: () => void,
) => machineActions.setAutoReconnect(instanceId, enabled, { onCommitted, onFailed });

export const removeMachine = (instanceId: string, onCommitted?: () => void, onFailed?: () => void) =>
  machineActions.remove(instanceId, { onCommitted, onFailed });

export const restoreMachine = (instanceId: string, onCommitted?: () => void, onFailed?: () => void) =>
  machineActions.restore(instanceId, { onCommitted, onFailed });
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

export function navigateProjectSession(sessionId: string, callbacks: OpenSessionCallbacks = {}): boolean {
  return sessionActivation.navigate(sessionId, callbacks);
}

// Browser UI authenticates through AuthGate and an HttpOnly cookie. The
// remembered token lives in localStorage (peri_studio_token) and is replayed by
// AuthGate only; the session itself is never recovered from Web Storage here.

// P1 拆分：以下符号迁至 features/message/panel-errors 与 user-actions，此处
// re-export 保持组件与旧调用点的导入路径不变。
export { refreshCurrentControlProjection, selectChat };
export {
  dismissPersistentError,
  reportTransportIssue,
  retryPersistentAction,
  retainPersistentErrors,
} from '../features/message/panel-errors';
export {
  retryMessageSubmission,
  cancelTurn,
  setSessionConfig,
  retrySessionConfigMutation,
  closeChat,
  resolvePermission,
  respondElicitation,
  respondQuestion,
} from '../features/message/user-actions';
export { sendMessage };
export type { PersistentError } from '../features/message/panel-errors';
export type { SessionConfigMutation } from '../features/message/user-actions';

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
} from '@/features/resource/resource-store';
export {
  clearSubmittedWorkspaceUploads,
  createEmptyExplorerFile,
  enqueueComposerRootUpload,
  enqueueExplorerUpload,
  enqueueQuickStartRootUpload,
  explorerCreatedFileFocus,
  markWorkspaceUploadReferenceInjected,
  retryWorkspaceUpload,
  workspaceUploadAvailable,
  workspaceUploadBlockedMessage,
  workspaceUploadBatch,
  workspaceUploadLiveMessage,
  workspaceUploadOrigin,
  workspaceUploadProgressPercent,
  workspaceUploadTileStatus,
  resetWorkspaceUploadAssembly,
};
export type { WorkspaceUploadOrigin } from './workspace-upload';
export {
  clearFsMutation,
  createResourceDirectory,
  deleteResourcePath,
  fsMutationAvailability,
  fsMutationState,
  moveResourcePath,
  retryFsMutation,
} from './fs-mutations';
export {
  openWorkspaceFromTool,
  resourceWorkbenchRequest,
} from './resource-workbench-request';
export type { ResourceWorkbenchRequest } from './resource-workbench-request';
