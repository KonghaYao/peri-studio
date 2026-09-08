import { createSignal } from 'solid-js';
import { canMutate } from '@/features/auth/auth-role';
import { principalRole } from '@/features/auth/auth-state';
import { connectionReady, sendFrame } from '@/features/connection/connection';
import {
  closeResourceFilePreview,
  openFilePreview,
  openResourceDirectory,
  refreshResourceProject,
  resourceFilePreview,
  resourceWorkspace,
  resourceWorkspaceGeneration,
} from '@/features/resource/resource-store';
import { FsMutationController, type FsMutationState } from '@/features/resource/fs-mutation-controller';
import type { DeleteConfirmResultFrame, FsMutationAck, FsMutationAction, FsMutationError } from '@/shared/protocol/resource-fs-mutation';
import type { ActionFrame } from '@/shared/protocol/action-contract';

type SendAction = (frame: ActionFrame, label: string, options: {
  cb?: (ack: FsMutationAck) => void;
  onError?: (error: FsMutationError) => void;
  onTimeout?: () => void;
  retryOnUncertain?: boolean;
}) => boolean;

let sendAction: SendAction = () => false;
export function bindFsMutationActionSender(sender: SendAction): void { sendAction = sender; }

export const [fsMutationState, setFsMutationState] = createSignal<FsMutationState>({
  projectId: null, commandId: null, kind: null, path: null, phase: 'idle', message: null,
});

type FsMutationProject = { id: string; instanceId: string };
type FsMutationInstance = {
  id: string;
  status: string | null;
  resourceProtocolVersion?: number | null;
  resourceWrite?: boolean;
  resourceStructuralMutations?: boolean;
};

export function structuralMutationCapability(
  projectId: string,
  projectCatalog: readonly FsMutationProject[],
  instanceCatalog: readonly FsMutationInstance[],
): boolean {
  const project = projectCatalog.find((item) => item.id === projectId);
  const instance = project && instanceCatalog.find((item) => item.id === project.instanceId);
  return instance?.status === 'online'
    && instance.resourceProtocolVersion === 5
    && instance.resourceWrite === true
    && instance.resourceStructuralMutations === true;
}

function supportsStructuralMutations(projectId: string): boolean {
  return structuralMutationCapability(projectId, projects(), instances());
}

let projects: () => FsMutationProject[] = () => [];
let instances: () => FsMutationInstance[] = () => [];

export function installFsMutationCatalog(deps: { projects: typeof projects; instances: typeof instances }): void {
  projects = deps.projects;
  instances = deps.instances;
}

const controller = new FsMutationController({
  ready: connectionReady,
  canMutate: () => canMutate(principalRole()),
  supportsStructuralMutations,
  generation: resourceWorkspaceGeneration,
  newId: () => crypto.randomUUID(),
  sendAction: (frame, callbacks) => sendAction(frame as ActionFrame, 'Change file tree', {
    cb: callbacks.onTerminal,
    onError: callbacks.onError,
    onTimeout: callbacks.onUncertain,
    retryOnUncertain: true,
  }),
  sendQuery: (frame) => sendFrame(frame),
  refreshDirectories: (projectId, paths, generation) => {
    if (resourceWorkspace().projectId !== projectId || resourceWorkspaceGeneration() !== generation) return;
    for (const path of paths) openResourceDirectory(path);
  },
  refreshProject: (projectId, generation) => {
    if (resourceWorkspace().projectId === projectId && resourceWorkspaceGeneration() === generation) refreshResourceProject();
  },
  onMoved: (source) => {
    if (resourceFilePreview()?.path === source) closeResourceFilePreview();
  },
  onDeleted: (path) => {
    if (resourceFilePreview()?.path === path) closeResourceFilePreview();
  },
  onCreatedFile: openFilePreview,
  onChange: setFsMutationState,
});

export function fsMutationAvailability(projectId: string | null) { return controller.availability(projectId); }
export function createResourceDirectory(projectId: string, path: string) { return controller.createDirectory(projectId, path); }
export function moveResourcePath(projectId: string, source: string, target: string, revision: string) { return controller.move(projectId, source, target, revision); }
export function deleteResourcePath(projectId: string, path: string, revision: string, recursive: boolean) {
  return recursive
    ? controller.requestRecursiveDelete(projectId, path, revision)
    : controller.delete(projectId, path, revision, false);
}
export function retryFsMutation(projectId: string) { return controller.retry(projectId); }
export function clearFsMutation(projectId: string) { controller.clear(projectId); }
export function forwardFsMutationResourceResult(frame: DeleteConfirmResultFrame) { return controller.handleResourceResult(frame); }
export type { FsMutationAction };
