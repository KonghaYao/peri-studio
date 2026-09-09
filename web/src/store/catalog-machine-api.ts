// Catalog / machine / session 导航：薄委托，由组合根 wire 后经 @/store 再导出。

import type { CatalogActions } from '@/features/catalog/catalog-actions';
import type { MachineActions } from '@/features/machine/machine-actions';
import type { OpenSessionCallbacks, SessionActivation } from '@/features/session/session-activation';

let catalogActions: CatalogActions;
let machineActions: MachineActions;
let sessionActivation: SessionActivation;

export function wireCatalogMachineApi(deps: {
  catalogActions: CatalogActions;
  machineActions: MachineActions;
  sessionActivation: SessionActivation;
}): void {
  catalogActions = deps.catalogActions;
  machineActions = deps.machineActions;
  sessionActivation = deps.sessionActivation;
}

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

export const createSessionWithFirstMessage = (projectId: string, text: string): boolean =>
  sessionActivation.quickStart(projectId, text);

export const retryQuickStart = (): void => sessionActivation.retryQuickStart();

export const renameProjectSession = (sessionId: string, name: string, onCommitted?: () => void, onFailed?: () => void) =>
  catalogActions.renameSession(sessionId, name, { onCommitted, onFailed });

export const archiveProjectSession = (sessionId: string, onCommitted?: () => void, onFailed?: () => void) =>
  catalogActions.setSessionArchived(sessionId, true, { onCommitted, onFailed });

export const restoreProjectSession = (sessionId: string, onCommitted?: () => void, onFailed?: () => void) =>
  catalogActions.setSessionArchived(sessionId, false, { onCommitted, onFailed });

export const importProjectSession = (
  projectId: string,
  acpSessionId: string,
  onCommitted?: () => void,
  onFailed?: (kind: 'failed' | 'uncertain') => void,
) => catalogActions.importSession(projectId, acpSessionId, onCommitted, onFailed);

export const discoverProjectSessions = (
  projectId: string,
  onCommitted?: () => void,
  onFailed?: (message: string) => void,
) => catalogActions.discoverSessions(projectId, onCommitted, onFailed);

export function navigateProjectSession(sessionId: string, callbacks: OpenSessionCallbacks = {}): boolean {
  return sessionActivation.navigate(sessionId, callbacks);
}
