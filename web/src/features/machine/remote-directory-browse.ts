import { DocStore } from '@/shared/yjs/doc-store';
import { renderResourceView } from '@/entities/resource/resource-view';
import {
  openResourceView,
  releaseResourceView,
  type ResourceResultFrame,
} from '../../panel/lib/resource-protocol';

/** Server accepts instance-scoped `resource/open-view` for remote directory browse. */
export function supportsInstanceScopedBrowse(): boolean {
  return true;
}

/** Trusted browse root for instance-scoped open-view (server resolves on instance). */
export const INSTANCE_BROWSE_ROOT = '/';

export interface RemoteDirectoryEntry {
  name: string;
  /** Workspace-relative path used for protocol navigation. */
  relativePath: string;
  /** Absolute path on the remote computer for project/create cwd. */
  absolutePath: string;
  kind: 'directory' | 'file' | 'other';
}

export interface RemoteDirectorySnapshot {
  loading: boolean;
  error: string | null;
  retryable: boolean;
  relativePath: string;
  absolutePath: string;
  entries: RemoteDirectoryEntry[];
  nextCursor?: string;
}

export interface RemoteDirectoryBrowseDependencies {
  ready: () => boolean;
  send: (frame: unknown) => boolean;
  subscribe: (docId: string) => void;
  unsubscribe: (docId: string) => void;
}

interface OpenLease {
  viewId: string;
  docId: string;
  expiresAt: number;
  timer?: number;
}

interface PendingRequest {
  requestId: string;
  relativePath: string;
  cursor?: string;
}

const initialSnapshot = (): RemoteDirectorySnapshot => ({
  loading: false,
  error: null,
  retryable: false,
  relativePath: '',
  absolutePath: '',
  entries: [],
});

export function joinRemotePath(root: string, relative: string): string {
  const normalizedRoot = root.replace(/\/+$/, '') || '/';
  if (!relative) return normalizedRoot;
  const segment = relative.replace(/^\/+/, '');
  if (normalizedRoot === '/') return `/${segment}`;
  return `${normalizedRoot}/${segment}`;
}

function entryKind(value: unknown): RemoteDirectoryEntry['kind'] {
  if (value === 'directory') return 'directory';
  if (value === 'file') return 'file';
  return 'other';
}

let activeBrowser: RemoteDirectoryBrowser | null = null;

export function installActiveRemoteDirectoryBrowser(browser: RemoteDirectoryBrowser | null): void {
  activeBrowser = browser;
}

export function forwardRemoteDirectoryResourceResult(frame: ResourceResultFrame): boolean {
  return activeBrowser?.handleResult(frame) ?? false;
}

export function forwardRemoteDirectoryResourceUpdate(frame: { doc: string; update: string }): boolean {
  return activeBrowser?.handleUpdate(frame) ?? false;
}

export class RemoteDirectoryBrowser {
  private readonly docs = new DocStore();
  private readonly deps: RemoteDirectoryBrowseDependencies;
  private instanceId: string | null = null;
  private pending: PendingRequest | null = null;
  private lease: OpenLease | null = null;
  private snapshot = initialSnapshot();
  private onChange: ((snapshot: RemoteDirectorySnapshot) => void) | null = null;

  constructor(deps: RemoteDirectoryBrowseDependencies) {
    this.deps = deps;
    this.docs.onUpdate = (docId) => {
      if (this.lease?.docId !== docId) return;
      this.consumeDirectory(docId);
    };
  }

  setOnChange(listener: ((snapshot: RemoteDirectorySnapshot) => void) | null): void {
    this.onChange = listener;
    if (listener) listener(this.snapshot);
  }

  current(): RemoteDirectorySnapshot {
    return this.snapshot;
  }

  open(instanceId: string, _projects?: readonly unknown[], relativePath = ''): void {
    this.instanceId = instanceId;
    if (!this.deps.ready()) {
      this.setSnapshot({
        ...initialSnapshot(),
        relativePath,
        absolutePath: joinRemotePath(INSTANCE_BROWSE_ROOT, relativePath),
        error: 'Connection not ready.',
        retryable: true,
      });
      return;
    }
    this.releaseLease();
    this.setSnapshot({
      loading: true,
      error: null,
      retryable: false,
      relativePath,
      absolutePath: joinRemotePath(INSTANCE_BROWSE_ROOT, relativePath),
      entries: [],
    });
    this.requestPage(instanceId, relativePath);
  }

  openDirectory(relativePath: string): void {
    if (!this.instanceId) return;
    this.open(this.instanceId, undefined, relativePath);
  }

  loadMore(): void {
    if (!this.instanceId || !this.snapshot.nextCursor || this.snapshot.loading) return;
    this.setSnapshot({ ...this.snapshot, loading: true, error: null });
    this.requestPage(this.instanceId, this.snapshot.relativePath, this.snapshot.nextCursor);
  }

  close(): void {
    this.pending = null;
    this.releaseLease();
    this.docs.clear();
    this.setSnapshot(initialSnapshot());
    this.instanceId = null;
  }

  handleResult(frame: ResourceResultFrame): boolean {
    if (!this.pending || frame.requestId !== this.pending.requestId) return false;
    const relativePath = this.pending.relativePath;
    const cursor = this.pending.cursor;
    this.pending = null;
    if (frame.error) {
      this.setSnapshot({
        ...this.snapshot,
        loading: false,
        error: frame.error.message,
        retryable: frame.error.retryable,
      });
      return true;
    }
    if (frame.result?.kind !== 'view') {
      this.setSnapshot({
        ...this.snapshot,
        loading: false,
        error: 'Unexpected browse response.',
        retryable: true,
      });
      return true;
    }
    const expiresAt = Date.parse(frame.result.data.leaseExpiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      this.deps.send(releaseResourceView(frame.result.data.viewId));
      this.setSnapshot({
        ...this.snapshot,
        loading: false,
        error: 'Directory lease expired before it opened.',
        retryable: true,
      });
      return true;
    }
    this.releaseLease();
    this.lease = {
      viewId: frame.result.data.viewId,
      docId: frame.result.data.docId,
      expiresAt,
    };
    this.scheduleLeaseDeadline();
    this.deps.subscribe(frame.result.data.docId);
    if (!cursor) {
      this.setSnapshot({
        ...this.snapshot,
        loading: true,
        relativePath,
        absolutePath: joinRemotePath(INSTANCE_BROWSE_ROOT, relativePath),
        entries: [],
        nextCursor: undefined,
      });
    }
    return true;
  }

  handleUpdate(frame: { doc: string; update: string }): boolean {
    if (!this.lease || frame.doc !== this.lease.docId) return false;
    if (Date.now() >= this.lease.expiresAt) {
      this.expireLease();
      return true;
    }
    this.docs.applyUpdateFrame(frame);
    return true;
  }

  private requestPage(instanceId: string, relativePath: string, cursor?: string): void {
    const frame = openResourceView(
      { instanceId },
      {
        kind: 'fs-directory-page',
        path: relativePath,
        cursor,
      },
    );
    if (!this.deps.send(frame)) {
      this.setSnapshot({
        ...this.snapshot,
        loading: false,
        error: 'Could not request remote directory.',
        retryable: true,
      });
      return;
    }
    this.pending = { requestId: frame.requestId, relativePath, cursor };
  }

  private consumeDirectory(docId: string): void {
    if (!this.instanceId || this.lease?.docId !== docId) return;
    const view = renderResourceView(docId, this.docs.docFor(docId));
    if (!view || view.viewType !== 'fs_directory_page') return;
    const relativePath = view.path ?? '';
    const directories = view.entries
      .filter((entry) => entry.kind === 'directory')
      .map((entry) => {
        const relativePath = String(entry.path ?? entry.id);
        return {
          name: String(entry.name ?? entry.id),
          relativePath,
          absolutePath: joinRemotePath(INSTANCE_BROWSE_ROOT, relativePath),
          kind: entryKind(entry.kind),
        };
      })
      .filter((entry) => entry.kind === 'directory');
    const mergedEntries = this.pending?.cursor
      ? [...this.snapshot.entries, ...directories]
      : directories;
    this.setSnapshot({
      loading: false,
      error: null,
      retryable: false,
      relativePath,
      absolutePath: joinRemotePath(INSTANCE_BROWSE_ROOT, relativePath),
      entries: mergedEntries,
      nextCursor: view.nextCursor,
    });
  }

  private setSnapshot(next: RemoteDirectorySnapshot): void {
    this.snapshot = next;
    this.onChange?.(next);
  }

  private releaseLease(): void {
    if (!this.lease) return;
    if (this.lease.timer !== undefined) window.clearTimeout(this.lease.timer);
    this.deps.unsubscribe(this.lease.docId);
    this.deps.send(releaseResourceView(this.lease.viewId));
    this.docs.drop(this.lease.docId);
    this.lease = null;
  }

  private scheduleLeaseDeadline(): void {
    if (!this.lease) return;
    const tick = () => {
      if (!this.lease) return;
      const remaining = this.lease.expiresAt - Date.now();
      if (remaining > 0) {
        this.lease.timer = window.setTimeout(tick, Math.min(remaining, 2_147_000_000));
        return;
      }
      this.expireLease();
    };
    tick();
  }

  private expireLease(): void {
    this.setSnapshot({
      ...this.snapshot,
      loading: false,
      error: 'Directory lease expired.',
      retryable: true,
      entries: [],
      nextCursor: undefined,
    });
    this.releaseLease();
  }
}
