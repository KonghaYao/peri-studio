import {
  fsCreateDirAction,
  fsDeleteAction,
  fsMoveAction,
  openDeleteConfirm,
  type DeleteConfirmResultFrame,
  type FsMutationAck,
  type FsMutationAction,
  type FsMutationError,
  type FsMutationResult,
} from '@/shared/protocol/resource-fs-mutation';

export type FsMutationPhase = 'idle' | 'pending' | 'uncertain' | 'conflict' | 'error';
export interface FsMutationState {
  projectId: string | null;
  commandId: string | null;
  kind: FsMutationKind | null;
  path: string | null;
  phase: FsMutationPhase;
  message: string | null;
  focusPath?: string;
}
export type FsMutationKind = 'create-dir' | 'move' | 'delete';

interface ControllerDeps {
  ready: () => boolean;
  canMutate: () => boolean;
  supportsStructuralMutations: (projectId: string) => boolean;
  generation: () => number;
  newId: () => string;
  sendAction: (frame: FsMutationAction, callbacks: {
    onTerminal: (ack: FsMutationAck) => void;
    onError: (error: FsMutationError) => void;
    onUncertain: () => void;
  }) => boolean;
  sendQuery: (frame: ReturnType<typeof openDeleteConfirm>) => boolean;
  refreshDirectories: (projectId: string, paths: string[], generation: number) => void;
  refreshProject: (projectId: string, generation: number) => void;
  onCreatedFile?: (path: string) => void;
  onMoved?: (source: string, target: string) => void;
  onDeleted?: (path: string) => void;
  onChange?: (state: FsMutationState) => void;
}

interface PendingDeleteConfirm {
  requestId: string;
  projectId: string;
  path: string;
  revision: string;
  generation: number;
}

const initialState = (): FsMutationState => ({ projectId: null, commandId: null, kind: null, path: null, phase: 'idle', message: null });

export class FsMutationController {
  private readonly states = new Map<string, FsMutationState>();
  private readonly frames = new Map<string, { frame: FsMutationAction; generation: number }>();
  private pendingConfirm: PendingDeleteConfirm | null = null;

  constructor(private readonly deps: ControllerDeps) {}

  state(projectId: string | null): FsMutationState {
    return projectId ? this.states.get(projectId) ?? initialState() : initialState();
  }

  availability(projectId: string | null): { available: boolean; reason: string } {
    if (!projectId) return { available: false, reason: 'Open a project session to change files.' };
    if (!this.deps.canMutate()) return { available: false, reason: 'File changes require Full access.' };
    if (!this.deps.ready()) return { available: false, reason: 'Connect to the server to change files.' };
    if (!this.deps.supportsStructuralMutations(projectId)) {
      return { available: false, reason: 'File changes are not supported on this workspace.' };
    }
    if (this.state(projectId).phase !== 'idle') return { available: false, reason: 'Another file change is still in progress.' };
    return { available: true, reason: '' };
  }

  createDirectory(projectId: string, path: string): boolean {
    return this.start(projectId, 'create-dir', path, fsCreateDirAction(this.deps.newId(), projectId, path));
  }

  move(projectId: string, source: string, target: string, revision: string): boolean {
    return this.start(projectId, 'move', source, fsMoveAction(this.deps.newId(), projectId, source, target, revision));
  }

  delete(projectId: string, path: string, revision: string, recursive: boolean, confirmToken?: string): boolean {
    return this.start(projectId, 'delete', path, fsDeleteAction(this.deps.newId(), projectId, path, revision, recursive, confirmToken));
  }

  requestRecursiveDelete(projectId: string, path: string, revision: string): boolean {
    if (!this.availability(projectId).available) return false;
    const requestId = this.deps.newId();
    this.pendingConfirm = { requestId, projectId, path, revision, generation: this.deps.generation() };
    this.set(projectId, { projectId, commandId: null, kind: 'delete', path, phase: 'pending', message: 'Preparing permanent delete…' });
    if (this.deps.sendQuery(openDeleteConfirm(requestId, projectId, path, revision))) return true;
    this.pendingConfirm = null;
    this.fail(projectId, 'Unable to prepare permanent delete.');
    return false;
  }

  handleResourceResult(frame: DeleteConfirmResultFrame): boolean {
    const pending = this.pendingConfirm;
    if (!pending || frame.requestId !== pending.requestId) return false;
    this.pendingConfirm = null;
    if (pending.generation !== this.deps.generation()) {
      this.states.delete(pending.projectId);
      return true;
    }
    if (frame.error || !frame.result || frame.result.kind !== 'delete_confirm') {
      this.fail(pending.projectId, mapError(frame.error?.code));
      return true;
    }
    this.set(pending.projectId, initialState());
    this.delete(pending.projectId, pending.path, pending.revision, true, frame.result.data.confirmToken);
    return true;
  }

  retry(projectId: string): boolean {
    const state = this.state(projectId);
    const pending = state.commandId ? this.frames.get(state.commandId) : undefined;
    if (!pending || state.phase !== 'uncertain') return false;
    if (pending.generation !== this.deps.generation()) return false;
    this.set(projectId, { ...state, phase: 'pending', message: 'Reconciling file change…' });
    if (this.dispatch(projectId, pending.frame, pending.generation)) return true;
    this.set(projectId, { ...state, phase: 'uncertain', message: 'Delivery is still uncertain. Reconcile with the same command before continuing.' });
    return false;
  }

  clear(projectId: string): void {
    const commandId = this.state(projectId).commandId;
    if (commandId) this.frames.delete(commandId);
    this.set(projectId, initialState());
  }

  private start(projectId: string, kind: FsMutationKind, path: string, frame: FsMutationAction): boolean {
    if (!this.availability(projectId).available) return false;
    const generation = this.deps.generation();
    this.frames.set(frame.commandId, { frame, generation });
    this.set(projectId, { projectId, commandId: frame.commandId, kind, path, phase: 'pending', message: pendingMessage(kind) });
    if (this.dispatch(projectId, frame, generation)) return true;
    this.frames.delete(frame.commandId);
    this.fail(projectId, 'File change could not be sent.');
    return false;
  }

  private dispatch(projectId: string, frame: FsMutationAction, generation: number): boolean {
    return this.deps.sendAction(frame, {
      onTerminal: (ack) => this.complete(projectId, frame, ack, generation),
      onError: (error) => this.error(projectId, frame, error, generation),
      onUncertain: () => this.set(projectId, { ...this.state(projectId), phase: 'uncertain', message: 'Delivery is uncertain. Reconcile with the same command before continuing.' }),
    });
  }

  private complete(projectId: string, frame: FsMutationAction, ack: FsMutationAck, generation: number): void {
    if (generation !== this.deps.generation()) {
      this.frames.delete(frame.commandId);
      this.states.delete(projectId);
      return;
    }
    const result = ack.resourceResult?.kind === 'fs_mutation' ? ack.resourceResult.data : undefined;
    this.frames.delete(frame.commandId);
    this.set(projectId, {
      ...initialState(),
      projectId,
      commandId: frame.commandId,
      focusPath: successFocusPath(frame, result),
    });
    this.applySuccess(frame, result);
    const paths = result?.affectedPaths ?? affectedParents(frame);
    if (paths.length) this.deps.refreshDirectories(projectId, paths, generation);
    else this.deps.refreshProject(projectId, generation);
  }

  private error(projectId: string, frame: FsMutationAction, error: FsMutationError, generation: number): void {
    if (generation !== this.deps.generation()) {
      this.frames.delete(frame.commandId);
      this.states.delete(projectId);
      return;
    }
    if (error.code === 'DELIVERY_UNKNOWN') {
      this.set(projectId, { ...this.state(projectId), phase: 'uncertain', message: mapError(error.code) });
      return;
    }
    this.frames.delete(frame.commandId);
    const conflict = error.code === 'VERSION_CONFLICT';
    this.set(projectId, { ...this.state(projectId), phase: conflict ? 'conflict' : 'error', message: mapError(error.code) });
    if (!conflict) this.deps.refreshProject(projectId, generation);
  }

  private applySuccess(frame: FsMutationAction, result?: FsMutationResult): void {
    if (frame.type === 'fs/move') this.deps.onMoved?.(frame.payload.source, frame.payload.target);
    else if (frame.type === 'fs/delete') this.deps.onDeleted?.(frame.payload.path);
    if (result?.stat?.kind === 'file' && frame.type === 'fs/create-dir') this.deps.onCreatedFile?.(result.primaryPath);
  }

  private fail(projectId: string, message: string): void {
    this.set(projectId, { ...this.state(projectId), phase: 'error', message });
  }

  private set(projectId: string, state: FsMutationState): void {
    this.states.set(projectId, state);
    this.deps.onChange?.(state);
  }
}

export function validateMutationName(name: string): string | null {
  if (!name.trim()) return 'Enter a name.';
  if (name !== name.trim()) return 'Names cannot start or end with spaces.';
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) return 'Enter a single file or folder name.';
  return null;
}

export function parentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function successFocusPath(frame: FsMutationAction, result?: FsMutationResult): string {
  if (frame.type === 'fs/move') return result?.primaryPath ?? frame.payload.target;
  if (frame.type === 'fs/delete') return parentPath(frame.payload.path);
  return result?.primaryPath ?? frame.payload.path;
}

function affectedParents(frame: FsMutationAction): string[] {
  if (frame.type === 'fs/move') return [...new Set([parentPath(frame.payload.source), parentPath(frame.payload.target)])];
  return [parentPath(frame.payload.path)];
}

function pendingMessage(kind: FsMutationKind): string {
  if (kind === 'create-dir') return 'Creating folder…';
  if (kind === 'move') return 'Moving item…';
  return 'Deleting item…';
}

export function mapError(code?: string): string {
  if (code === 'VERSION_CONFLICT') return 'This item changed on disk. Refresh Explorer and try again.';
  if (code === 'DELIVERY_UNKNOWN') return 'Delivery is uncertain. Refresh to inspect the filesystem, then reconcile with the same command.';
  if (code === 'FORBIDDEN') return 'File changes require Full access.';
  if (code === 'INSTANCE_OFFLINE' || code === 'AGENT_UNAVAILABLE' || code === 'UNAVAILABLE') return 'The workspace is offline or unavailable.';
  if (code === 'INVALID_STATE' || code === 'UNSUPPORTED_FRAME') return 'File changes are not supported on this workspace.';
  return 'The file change failed. Explorer will refresh.';
}
