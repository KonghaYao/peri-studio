import { createEffect, createRoot, createSignal } from 'solid-js';
import { connectionReady, sendFrame } from '../panel/lib/connection';
import { canMutate, type PrincipalRole } from '../panel/lib/auth-role';
import { principalRole } from '../panel/lib/auth-state';
import { activateResourceProject, resourceWorkspace, resourceWorkspaceGeneration } from '../panel/lib/resource-store';
import { putResourceUploadBytes } from '@/features/resource/upload-http-put';
import {
  forwardWorkspaceUploadActionAck,
  forwardWorkspaceUploadActionError,
  forwardWorkspaceUploadResourceResult,
  installActiveWorkspaceUploadQueue,
  WorkspaceUploadQueue,
  type WorkspaceUploadBatchView,
  type WorkspaceUploadItemView,
} from '@/features/resource/upload-workspace-file';
import { composerWorkspaceUploadPath, pickLocalUploadFiles } from '@/features/resource/upload-path';
import type { ActionFrame } from '../panel/lib/action-contract';

export type WorkspaceUploadOrigin = 'composer' | 'explorer' | 'quickstart';

const [workspaceUploadBatch, setWorkspaceUploadBatch] = createSignal<WorkspaceUploadBatchView | null>(null);
const [workspaceUploadLiveMessage, setWorkspaceUploadLiveMessage] = createSignal('');
const uploadItemOrigins = new Map<string, WorkspaceUploadOrigin>();

let uploadQueue: WorkspaceUploadQueue | null = null;
let explorerRefreshInFlight = false;
let pendingExplorerRefresh = false;
let refreshResourceProject: (() => void) | null = null;

type SendActionFn = (frame: ActionFrame, label: string) => boolean;

let sendWorkspaceAction: SendActionFn = () => false;

export function bindWorkspaceUploadActionSender(sendAction: SendActionFn): void {
  sendWorkspaceAction = sendAction;
}

export function bindWorkspaceUploadExplorerRefresh(refresh: () => void): void {
  refreshResourceProject = refresh;
}

function canUploadNow(role: PrincipalRole): boolean {
  return canMutate(role) && connectionReady();
}

function uploadBlockMessage(role: PrincipalRole): string {
  if (!canMutate(role)) return 'Upload requires Full access. Switch to an account with write permission.';
  if (!connectionReady()) return 'Connect to the server before uploading files.';
  const projectId = resourceWorkspace().projectId;
  if (!projectId) return 'Open a project session before uploading files.';
  return 'Upload is unavailable right now.';
}

function ensureQueue(): WorkspaceUploadQueue {
  if (uploadQueue) return uploadQueue;
  uploadQueue = new WorkspaceUploadQueue({
    ready: () => connectionReady(),
    canMutate: () => canMutate(principalRole()),
    generation: () => resourceWorkspaceGeneration(),
    sendResourceQuery: (frame) => sendFrame(frame),
    sendAction: (frame) => sendWorkspaceAction(frame, 'Write file'),
    putUpload: (url, body, onProgress, signal) => putResourceUploadBytes(url, body, { onProgress, signal }),
  });
  uploadQueue.setOnChange(handleUploadBatchChange);
  installActiveWorkspaceUploadQueue(uploadQueue);
  return uploadQueue;
}

export function workspaceUploadAvailable(projectId: string | null): boolean {
  return !!projectId && canUploadNow(principalRole());
}

export function workspaceUploadBlockedMessage(projectId: string | null): string {
  if (!projectId) return 'Open a project session before uploading files.';
  return uploadBlockMessage(principalRole());
}

export function workspaceUploadTileStatus(item: WorkspaceUploadItemView) {
  if (item.phase === 'queued' || item.phase === 'opening') return 'pending' as const;
  if (item.phase === 'uploading') return 'uploading' as const;
  if (item.phase === 'committing') return 'committing' as const;
  if (item.phase === 'ready') return 'ready' as const;
  return 'failed' as const;
}

export function workspaceUploadProgressPercent(item: WorkspaceUploadItemView): number {
  if (!item.progressTotal) return item.phase === 'ready' ? 100 : 0;
  return Math.round((item.progressLoaded / item.progressTotal) * 100);
}

function scheduleExplorerRefresh(): void {
  if (!refreshResourceProject) return;
  if (explorerRefreshInFlight) {
    pendingExplorerRefresh = true;
    return;
  }
  explorerRefreshInFlight = true;
  refreshResourceProject();
  queueMicrotask(() => {
    explorerRefreshInFlight = false;
    if (pendingExplorerRefresh) {
      pendingExplorerRefresh = false;
      scheduleExplorerRefresh();
    }
  });
}

let explorerUploadBusy = false;

export function explorerUploadRefreshTransition(
  wasBusy: boolean,
  items: readonly WorkspaceUploadItemView[],
): { busy: boolean; refresh: boolean } {
  const busy = items.some((item) => item.phase !== 'ready' && item.phase !== 'failed');
  const succeeded = items.some((item) => item.phase === 'ready');
  return { busy, refresh: wasBusy && !busy && succeeded };
}

function handleUploadBatchChange(view: WorkspaceUploadBatchView | null): void {
  setWorkspaceUploadBatch(view);
  if (!view) {
    explorerUploadBusy = false;
    return;
  }
  const explorerItems = view.items.filter((item) => uploadItemOrigins.get(item.id) === 'explorer');
  const transition = explorerUploadRefreshTransition(explorerUploadBusy, explorerItems);
  if (transition.refresh) scheduleExplorerRefresh();
  explorerUploadBusy = transition.busy;
}

export { workspaceUploadBatch, workspaceUploadLiveMessage, forwardWorkspaceUploadResourceResult, forwardWorkspaceUploadActionAck, forwardWorkspaceUploadActionError };

export function resetWorkspaceUploadAssembly(): void {
  uploadQueue?.reset();
  uploadItemOrigins.clear();
  setWorkspaceUploadBatch(null);
  setWorkspaceUploadLiveMessage('');
  explorerRefreshInFlight = false;
  pendingExplorerRefresh = false;
  explorerUploadBusy = false;
}

let boundUploadProjectId: string | null = null;
createRoot(() => {
  createEffect(() => {
    const projectId = resourceWorkspace().projectId;
    if (projectId === boundUploadProjectId) return;
    boundUploadProjectId = projectId;
    uploadQueue?.reset();
    uploadItemOrigins.clear();
    setWorkspaceUploadBatch(uploadQueue?.snapshot() ?? null);
  });
});

export function workspaceUploadOrigin(itemId: string): WorkspaceUploadOrigin | undefined {
  return uploadItemOrigins.get(itemId);
}

export function enqueueWorkspaceUpload(
  origin: WorkspaceUploadOrigin,
  projectId: string,
  files: readonly File[],
  targetDirectoryPath: string,
): boolean {
  const role = principalRole();
  if (!canUploadNow(role)) {
    setWorkspaceUploadLiveMessage(uploadBlockMessage(role));
    return false;
  }
  if (!projectId) {
    setWorkspaceUploadLiveMessage('Select a project before uploading files.');
    return false;
  }
  if (resourceWorkspace().projectId !== projectId) {
    activateResourceProject(projectId);
  }
  const picks = pickLocalUploadFiles(files, targetDirectoryPath);
  const queue = ensureQueue();
  const knownIds = new Set(queue.snapshot()?.items.map((item) => item.id) ?? []);
  queue.enqueue(projectId, picks);
  const snapshot = queue.snapshot();
  if (snapshot) {
    for (const item of snapshot.items) {
      if (!knownIds.has(item.id)) uploadItemOrigins.set(item.id, origin);
    }
    handleUploadBatchChange(snapshot);
  }
  const total = picks.length;
  const failedPrecheck = picks.filter((pick) => !pick.ok).length;
  if (failedPrecheck === total) {
    setWorkspaceUploadLiveMessage('No files were queued. Check size limits and file names.');
  } else {
    setWorkspaceUploadLiveMessage(`Uploading ${total - failedPrecheck} of ${total} file(s).`);
  }
  return true;
}

export function enqueueComposerRootUpload(projectId: string, files: readonly File[]): boolean {
  return enqueueWorkspaceUpload('composer', projectId, files, '');
}

export function enqueueQuickStartRootUpload(projectId: string, files: readonly File[]): boolean {
  return enqueueWorkspaceUpload('quickstart', projectId, files, '');
}

export function enqueueExplorerUpload(projectId: string, directoryPath: string, files: readonly File[]): boolean {
  return enqueueWorkspaceUpload('explorer', projectId, files, directoryPath);
}

export function retryWorkspaceUpload(itemId: string): void {
  ensureQueue().retry(itemId);
  setWorkspaceUploadLiveMessage('Retrying upload…');
}

export function markWorkspaceUploadReferenceInjected(itemId: string): void {
  ensureQueue().markReferenceInjected(itemId);
}

export function dismissWorkspaceUploadLiveMessage(): void {
  setWorkspaceUploadLiveMessage('');
}

export function composerUploadPathsForFiles(files: readonly File[]): ReturnType<typeof pickLocalUploadFiles> {
  return pickLocalUploadFiles(files, '');
}

export { composerWorkspaceUploadPath };
