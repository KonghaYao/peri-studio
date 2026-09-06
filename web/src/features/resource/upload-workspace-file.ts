import {
  fsWriteFileAction,
  openResourceUpload,
  type ResourceResultFrame,
} from '../../panel/lib/resource-protocol';
import { newCommandId } from '../../panel/lib/protocol';
import type { LocalUploadCandidate } from './upload-path';
import {
  mapActionErrorToUploadError,
  mapPrecheckRejectReason,
  mapPutHttpStatusToUploadError,
  mapResourceFailureToUploadError,
  type UploadUserFacingError,
} from './upload-errors';
import { MAX_CONCURRENT_UPLOAD_PUTS } from './upload-path';
import type { UploadPutProgress, UploadPutResult } from './upload-http-put';

export type WorkspaceUploadPhase =
  | 'queued'
  | 'opening'
  | 'uploading'
  | 'committing'
  | 'ready'
  | 'failed';

export interface WorkspaceUploadItemView {
  id: string;
  displayName: string;
  workspaceRelativePath: string;
  size: number;
  phase: WorkspaceUploadPhase;
  progressLoaded: number;
  progressTotal: number;
  error: UploadUserFacingError | null;
  /** commit 成功后的 server 路径（引用应使用此值）。 */
  committedPath: string | null;
  referenceInjected: boolean;
}

export interface WorkspaceUploadBatchView {
  generation: number;
  projectId: string;
  items: WorkspaceUploadItemView[];
}

export interface WorkspaceUploadDependencies {
  ready: () => boolean;
  canMutate: () => boolean;
  /** 当前 project 世代；切换后应忽略迟到结果。 */
  generation: () => number;
  sendResourceQuery: (frame: ReturnType<typeof openResourceUpload>) => boolean;
  sendAction: (frame: ReturnType<typeof fsWriteFileAction>) => boolean;
  putUpload: (
    url: string,
    body: Blob,
    onProgress?: (p: UploadPutProgress) => void,
    signal?: AbortSignal,
  ) => Promise<UploadPutResult>;
}

interface InternalItem extends LocalUploadCandidate {
  phase: WorkspaceUploadPhase;
  progressLoaded: number;
  progressTotal: number;
  error: UploadUserFacingError | null;
  committedPath: string | null;
  referenceInjected: boolean;
  openRequestId: string | null;
  commitCommandId: string | null;
  uploadId: string | null;
  putUrl: string | null;
  batchGeneration: number;
}

interface PendingOpen {
  itemId: string;
  generation: number;
  resolve: (frame: ResourceResultFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingCommit {
  itemId: string;
  generation: number;
  resolve: (outcome: CommitOutcome) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type CommitOutcome =
  | { ok: true; path: string }
  | { ok: false; error: UploadUserFacingError };

const OPEN_TIMEOUT_MS = 60_000;
const COMMIT_TIMEOUT_MS = 120_000;

function toView(item: InternalItem): WorkspaceUploadItemView {
  return {
    id: item.id,
    displayName: item.displayName,
    workspaceRelativePath: item.workspaceRelativePath,
    size: item.size,
    phase: item.phase,
    progressLoaded: item.progressLoaded,
    progressTotal: item.progressTotal,
    error: item.error,
    committedPath: item.committedPath,
    referenceInjected: item.referenceInjected,
  };
}

function parseFsStatPath(ack: Record<string, unknown>): string | null {
  const resourceResult = ack.resourceResult as Record<string, unknown> | undefined;
  if (!resourceResult || resourceResult.kind !== 'fs_stat') return null;
  const data = resourceResult.data as Record<string, unknown> | undefined;
  if (!data || typeof data.path !== 'string') return null;
  return data.path;
}

function isUploadUserFacingError(value: unknown): value is UploadUserFacingError {
  return !!value && typeof value === 'object' && 'message' in value && 'retryable' in value;
}

export class WorkspaceUploadQueue {
  private readonly deps: WorkspaceUploadDependencies;
  private readonly items = new Map<string, InternalItem>();
  private readonly order: string[] = [];
  private projectId: string | null = null;
  private activePutCount = 0;
  private readonly pendingOpens = new Map<string, PendingOpen>();
  private readonly pendingCommits = new Map<string, PendingCommit>();
  private readonly putControllers = new Map<string, AbortController>();
  private onChange: ((view: WorkspaceUploadBatchView | null) => void) | null = null;

  constructor(deps: WorkspaceUploadDependencies) {
    this.deps = deps;
  }

  setOnChange(listener: ((view: WorkspaceUploadBatchView | null) => void) | null): void {
    this.onChange = listener;
    listener?.(this.snapshot());
  }

  snapshot(): WorkspaceUploadBatchView | null {
    if (!this.projectId) return null;
    return {
      generation: this.deps.generation(),
      projectId: this.projectId,
      items: this.order.map((id) => toView(this.items.get(id)!)),
    };
  }

  /** 入队扁平文件；precheck 失败项直接标记 failed。 */
  enqueue(
    projectId: string,
    picks: Array<
      | { ok: true; candidate: LocalUploadCandidate }
      | { ok: false; reason: string; displayName: string }
    >,
  ): void {
    if (!this.deps.canMutate()) {
      return;
    }
    if (!this.deps.ready()) {
      return;
    }
    this.projectId = projectId;
    const batchGeneration = this.deps.generation();
    for (const pick of picks) {
      if (!pick.ok) {
        const id = crypto.randomUUID();
        const failed: InternalItem = {
          id,
          displayName: pick.displayName,
          size: 0,
          blob: new Blob(),
          workspaceRelativePath: '',
          phase: 'failed',
          progressLoaded: 0,
          progressTotal: 0,
          error: mapPrecheckRejectReason(pick.reason),
          committedPath: null,
          referenceInjected: false,
          openRequestId: null,
          commitCommandId: null,
          uploadId: null,
          putUrl: null,
          batchGeneration,
        };
        this.items.set(id, failed);
        this.order.push(id);
        continue;
      }
      const item: InternalItem = {
        ...pick.candidate,
        phase: 'queued',
        progressLoaded: 0,
        progressTotal: pick.candidate.size,
        error: null,
        committedPath: null,
        referenceInjected: false,
        openRequestId: null,
        commitCommandId: null,
        uploadId: null,
        putUrl: null,
        batchGeneration,
      };
      this.items.set(item.id, item);
      this.order.push(item.id);
    }
    this.emit();
    this.pump();
  }

  retry(itemId: string): void {
    const item = this.items.get(itemId);
    if (!item || item.phase !== 'failed') return;
    if (!this.deps.canMutate() || !this.deps.ready() || !this.projectId) return;
    item.phase = 'queued';
    item.error = null;
    item.progressLoaded = 0;
    item.openRequestId = null;
    item.commitCommandId = null;
    item.uploadId = null;
    item.putUrl = null;
    item.committedPath = null;
    item.referenceInjected = false;
    item.batchGeneration = this.deps.generation();
    this.emit();
    this.pump();
  }

  markReferenceInjected(itemId: string): void {
    const item = this.items.get(itemId);
    if (!item) return;
    item.referenceInjected = true;
    this.emit();
  }

  /** 仅移除已落盘的草稿资产；进行中或失败项仍由原队列负责。 */
  dismissReadyItems(itemIds: readonly string[]): void {
    const dismissed = new Set(itemIds.filter((id) => this.items.get(id)?.phase === 'ready'));
    if (dismissed.size === 0) return;
    for (const id of dismissed) this.items.delete(id);
    for (let index = this.order.length - 1; index >= 0; index -= 1) {
      if (dismissed.has(this.order[index]!)) this.order.splice(index, 1);
    }
    if (this.order.length === 0) this.projectId = null;
    this.emit();
  }

  handleResourceResult(frame: ResourceResultFrame): boolean {
    const pending = this.pendingOpens.get(frame.requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingOpens.delete(frame.requestId);
    if (pending.generation !== this.deps.generation()) {
      pending.reject(new Error('stale_generation'));
      return true;
    }
    pending.resolve(frame);
    return true;
  }

  handleActionAck(ack: Record<string, unknown>): boolean {
    const commandId = ack.commandId;
    if (typeof commandId !== 'string') return false;
    const pending = this.pendingCommits.get(commandId);
    if (!pending) return false;
    if (pending.generation !== this.deps.generation()) {
      clearTimeout(pending.timer);
      this.pendingCommits.delete(commandId);
      pending.reject(new Error('stale_generation'));
      return true;
    }
    const status = ack.status;
    if (status === 'accepted') return true;
    if (status !== 'committed' && status !== 'duplicate') return true;
    clearTimeout(pending.timer);
    this.pendingCommits.delete(commandId);
    const path = parseFsStatPath(ack) ?? this.items.get(pending.itemId)?.workspaceRelativePath ?? '';
    pending.resolve({ ok: true, path });
    return true;
  }

  handleActionError(error: Record<string, unknown>): boolean {
    const commandId = error.commandId;
    if (typeof commandId !== 'string') return false;
    const pending = this.pendingCommits.get(commandId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingCommits.delete(commandId);
    if (pending.generation !== this.deps.generation()) {
      pending.reject(new Error('stale_generation'));
      return true;
    }
    pending.resolve({ ok: false, error: mapActionErrorToUploadError(error) });
    return true;
  }

  reset(): void {
    for (const pending of this.pendingOpens.values()) {
      clearTimeout(pending.timer);
    }
    for (const pending of this.pendingCommits.values()) {
      clearTimeout(pending.timer);
    }
    for (const controller of this.putControllers.values()) {
      controller.abort();
    }
    this.putControllers.clear();
    this.pendingOpens.clear();
    this.pendingCommits.clear();
    this.items.clear();
    this.order.length = 0;
    this.projectId = null;
    this.activePutCount = 0;
    this.emit();
  }

  private emit(): void {
    this.onChange?.(this.snapshot());
  }

  private pump(): void {
    for (const id of this.order) {
      if (this.activePutCount >= MAX_CONCURRENT_UPLOAD_PUTS) break;
      const item = this.items.get(id);
      if (!item || item.phase !== 'queued') continue;
      item.phase = 'opening';
      this.activePutCount += 1;
      this.emit();
      void this.runItem(item);
    }
  }

  private async runItem(item: InternalItem): Promise<void> {
    const runGeneration = item.batchGeneration;
    try {
      if (!this.projectId || !this.isGenerationActive(runGeneration)) return;

      item.error = null;
      this.emit();

      const opened = await this.openTicket(item, runGeneration);
      if (!this.isGenerationActive(runGeneration)) return;

      item.uploadId = opened.uploadId;
      item.putUrl = opened.url;
      item.phase = 'uploading';
      item.progressLoaded = 0;
      item.progressTotal = item.size;
      this.emit();

      const controller = new AbortController();
      this.putControllers.set(item.id, controller);
      const put = await this.deps.putUpload(opened.url, item.blob, (progress) => {
        if (!this.isGenerationActive(runGeneration)) return;
        item.progressLoaded = progress.loaded;
        item.progressTotal = progress.total;
        this.emit();
      }, controller.signal);
      this.putControllers.delete(item.id);
      if (!this.isGenerationActive(runGeneration)) return;

      if (!put.ok) {
        this.fail(item, mapPutHttpStatusToUploadError(put.status));
        return;
      }

      item.phase = 'committing';
      item.progressLoaded = item.size;
      this.emit();

      const commit = await this.commitWrite(item, runGeneration);
      if (!this.isGenerationActive(runGeneration)) return;

      if (!commit.ok) {
        this.fail(item, commit.error);
      } else {
        item.phase = 'ready';
        item.committedPath = commit.path;
        item.error = null;
        this.emit();
      }
    } catch (error) {
      if (!this.isGenerationActive(runGeneration)) return;
      if (error instanceof Error && error.message === 'stale_generation') return;
      if (isUploadUserFacingError(error)) {
        this.fail(item, error);
        return;
      }
      if (error instanceof Error && error.message === 'transport_unavailable') {
        this.fail(item, { message: 'Connection unavailable.', retryable: true, code: 'UNAVAILABLE' });
        return;
      }
      if (error instanceof Error && error.message === 'open_timeout') {
        this.fail(item, { message: 'Upload timed out. Retry when the connection is stable.', retryable: true, code: 'TIMEOUT' });
        return;
      }
      this.fail(item, { message: 'Upload failed. Try again.', retryable: true, code: 'UNAVAILABLE' });
    } finally {
      this.putControllers.delete(item.id);
      this.activePutCount = Math.max(0, this.activePutCount - 1);
      this.pump();
    }
  }

  private isGenerationActive(generation: number): boolean {
    return generation === this.deps.generation();
  }

  private fail(item: InternalItem, error: UploadUserFacingError): void {
    item.phase = 'failed';
    item.error = error;
    this.emit();
  }

  private openTicket(
    item: InternalItem,
    generation: number,
  ): Promise<{ uploadId: string; url: string }> {
    if (!this.projectId) {
      return Promise.reject(new Error('missing_project'));
    }
    const frame = openResourceUpload(this.projectId, {
      path: item.workspaceRelativePath,
      expectedBytes: item.size,
    });
    if (!this.deps.sendResourceQuery(frame)) {
      return Promise.reject(new Error('transport_unavailable'));
    }
    item.openRequestId = frame.requestId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingOpens.delete(frame.requestId);
        reject(new Error('open_timeout'));
      }, OPEN_TIMEOUT_MS);
      this.pendingOpens.set(frame.requestId, {
        itemId: item.id,
        generation,
        timer,
        resolve: (result) => {
          if (result.error) {
            reject(mapResourceFailureToUploadError(result.error));
            return;
          }
          const data = result.result;
          if (!data || data.kind !== 'upload') {
            reject(new Error('invalid_open_result'));
            return;
          }
          resolve({ uploadId: data.data.uploadId, url: data.data.url });
        },
        reject: (error) => reject(error),
      });
    });
  }

  private commitWrite(item: InternalItem, generation: number): Promise<CommitOutcome> {
    if (!this.projectId || !item.uploadId) {
      return Promise.resolve({
        ok: false,
        error: { message: 'Upload commit failed. Try again.', retryable: true, code: 'UNAVAILABLE' },
      });
    }
    const commandId = newCommandId();
    const frame = fsWriteFileAction(commandId, this.projectId, item.workspaceRelativePath, item.uploadId, {
      ifNoneMatch: '*',
    });
    if (!this.deps.sendAction(frame)) {
      return Promise.resolve({
        ok: false,
        error: { message: 'Connection unavailable.', retryable: true, code: 'UNAVAILABLE' },
      });
    }
    item.commitCommandId = commandId;

    return new Promise<CommitOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingCommits.delete(commandId);
        resolve({
          ok: false,
          error: { message: 'Upload timed out. Retry when the connection is stable.', retryable: true, code: 'TIMEOUT' },
        });
      }, COMMIT_TIMEOUT_MS);
      this.pendingCommits.set(commandId, {
        itemId: item.id,
        generation,
        timer,
        resolve,
        reject: () => resolve({
          ok: false,
          error: { message: 'Upload failed. Try again.', retryable: true, code: 'UNAVAILABLE' },
        }),
      });
    });
  }
}

let activeQueue: WorkspaceUploadQueue | null = null;

export function installActiveWorkspaceUploadQueue(queue: WorkspaceUploadQueue | null): void {
  activeQueue = queue;
}

export function forwardWorkspaceUploadResourceResult(frame: ResourceResultFrame): boolean {
  return activeQueue?.handleResourceResult(frame) ?? false;
}

export function forwardWorkspaceUploadActionAck(ack: Record<string, unknown>): boolean {
  return activeQueue?.handleActionAck(ack) ?? false;
}

export function forwardWorkspaceUploadActionError(error: Record<string, unknown>): boolean {
  return activeQueue?.handleActionError(error) ?? false;
}
