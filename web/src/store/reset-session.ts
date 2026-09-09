// resetAuthenticatedSession 编排：调用顺序由 auth-contracts / store-session-reset 锁死。
import type { SessionActivation } from '@/features/session/session-activation';
import type { CommandTracker } from '@/features/connection/command-tracker';
import type { Ack, ActionError, ActionFrame } from '@/shared/protocol/action-contract';
import type { DocStore } from '@/shared/yjs/doc-store';
import type { ToastStore } from './toast-store';
import type { RuntimeDocsState } from './store-projection';
import type { ChatEntry } from '@/entities/chat/chat-view';
import type { ControlView } from '@/entities/chat/control-view';
import type { ProjectInfo, ProjectSessionInfo, SessionSummaryInfo, MachineInfo } from '@/entities/registry/registry-view';
import type { PersistentError } from '@/features/message/panel-errors';
import type { SessionConfigMutation } from '@/features/message/user-actions';
import type { Setter } from 'solid-js';
import { installPrincipalRole } from '@/features/auth/auth-state';
import { disconnect, resetConnectionState } from '@/features/connection/connection';
import { resetElicitationResponses } from '@/features/message/elicitation-delivery';
import { resetQuestionResponses } from '@/features/message/question-delivery';
import { resetMessageDelivery } from '@/features/message/message-delivery';
import { resetPermissionDecisions } from '@/features/message/permission-delivery';
import { resetRuntimeControls } from '@/features/runtime/runtime-control';
import { resetPromptRecoveryState } from '@/features/runtime/prompt-recovery-assembly';
import { resetRewindState } from '@/features/runtime/rewind-assembly';
import { resetTerminalSession } from '@/features/terminal/terminal-session';
import { resetResourceProject } from '@/features/resource/resource-store';

export type SessionCatalogBootstrap = {
  reset: () => void;
} | null;

export type SessionResetDeps = {
  setCurrentCid: (cid: string | null) => void;
  setSelectedCid: Setter<string | null>;
  setSelectedSessionId: Setter<string | null>;
  setChatEntries: Setter<ChatEntry[]>;
  setChatHead: Setter<ControlView | null>;
  setPermissions: Setter<ControlView['pendingPermissions']>;
  setElicitations: Setter<NonNullable<ControlView['pendingElicitations']>>;
  setQuestions: Setter<NonNullable<ControlView['pendingQuestions']>>;
  setRuntimeDocsState: Setter<RuntimeDocsState>;
  setChatStatusSignal: Setter<Record<string, string>>;
  setProjects: Setter<ProjectInfo[]>;
  setMachines: Setter<MachineInfo[]>;
  setProjectSessions: Setter<ProjectSessionInfo[]>;
  setImportableSessions: Setter<SessionSummaryInfo[]>;
  setDiscoveringSessionsProjectId: Setter<string | null>;
  setSessionConfigMutation: Setter<SessionConfigMutation | null>;
  setPersistentErrors: Setter<PersistentError[]>;
  setRegistryHydrated: Setter<boolean>;
  sessionActivation: SessionActivation;
  sessionCatalogBootstrap: () => SessionCatalogBootstrap;
  commands: CommandTracker<ActionFrame, Ack, ActionError>;
  docStore: DocStore;
  toastStore: ToastStore;
  resetWorkspaceUploadAssembly: () => void;
};

/** 静态契约：reset 步骤标识顺序（G5）；实现须与此数组一致。 */
export const AUTHENTICATED_SESSION_RESET_STEPS = [
  'installPrincipalRole(null)',
  'disconnect()',
  'resetConnectionState()',
  'clearCurrentCid',
  'setSelectedCid(null)',
  'setSelectedSessionId(null)',
  'setChatEntries([])',
  'setChatHead(null)',
  'setPermissions([])',
  'setElicitations([])',
  'setQuestions([])',
  'resetElicitationResponses()',
  'resetQuestionResponses()',
  'setRuntimeDocsState',
  'setChatStatusSignal({})',
  'setProjects([])',
  'setMachines([])',
  'setProjectSessions([])',
  'setImportableSessions([])',
  'resetPromptRecoveryState()',
  'resetMessageDelivery',
  'sessionActivation.reset()',
  'resetRuntimeControls()',
  'setSessionConfigMutation(null)',
  'resetRewindState()',
  'resetTerminalSession()',
  'setDiscoveringSessionsProjectId(null)',
  'sessionCatalogBootstrap.reset',
  'setPersistentErrors([])',
  'commands.reset()',
  'resetPermissionDecisions()',
  'setRegistryHydrated(false)',
  'docStore.clear()',
  'resetResourceProject()',
  'resetWorkspaceUploadAssembly()',
  'toastStore.clear()',
] as const;

export function createResetAuthenticatedSession(deps: SessionResetDeps) {
  return function resetAuthenticatedSession(options: { preserveLocalDrafts?: boolean } = {}): void {
    // Revoke mutation authority before settling callbacks from the old transport.
    // This function is intentionally idempotent: both the invalidation producer
    // and AuthGate consumer call it to make the identity boundary fail closed.
    installPrincipalRole(null);
    disconnect();
    resetConnectionState();
    deps.setCurrentCid(null);
    deps.setSelectedCid(null);
    deps.setSelectedSessionId(null);
    deps.setChatEntries([]);
    deps.setChatHead(null);
    deps.setPermissions([]);
    deps.setElicitations([]);
    deps.setQuestions([]);
    resetElicitationResponses();
    resetQuestionResponses();
    deps.setRuntimeDocsState({ chat: false, control: false });
    deps.setChatStatusSignal({});
    deps.setProjects([]);
    deps.setMachines([]);
    deps.setProjectSessions([]);
    deps.setImportableSessions([]);
    resetPromptRecoveryState();
    resetMessageDelivery(options.preserveLocalDrafts === true);
    deps.sessionActivation.reset();
    resetRuntimeControls();
    deps.setSessionConfigMutation(null);
    resetRewindState();
    resetTerminalSession();
    deps.setDiscoveringSessionsProjectId(null);
    deps.sessionCatalogBootstrap()?.reset();
    deps.setPersistentErrors([]);
    deps.commands.reset();
    resetPermissionDecisions();
    deps.setRegistryHydrated(false);
    deps.docStore.clear();
    resetResourceProject();
    deps.resetWorkspaceUploadAssembly();
    // Keep this last: disconnect/reset callbacks are allowed to publish feedback,
    // but no notification from the previous principal may survive this boundary.
    deps.toastStore.clear();
  };
}
