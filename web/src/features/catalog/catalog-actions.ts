import * as H from '../../panel/lib/protocol';

export type CatalogFrame = ReturnType<typeof H.action>;

export interface CatalogAck {
  commandId?: string;
  status?: string;
  sessionId?: string;
  chatId?: string;
  [key: string]: unknown;
}

export interface CatalogError {
  commandId?: string;
  code?: string;
  message?: string;
  retryable?: boolean;
}

export interface CatalogSendOptions {
  cb?: (ack: CatalogAck) => void;
  onTimeout?: () => void;
  onError?: (error: CatalogError) => void;
  retryOnUncertain?: boolean;
}

export interface CatalogActionsDependencies {
  isReady: () => boolean;
  isReadOnly: () => boolean;
  hasUncertainMetadata: () => boolean;
  send: (frame: CatalogFrame, label: string, options: CatalogSendOptions) => boolean;
  toast: (message: string) => void;
  persistProblem: (title: string, detail: string, commandId: string) => void;
  onProjectArchived: (projectId: string) => void;
  onSessionArchived: (sessionId: string) => void;
  discoveringProjectId: () => string | null;
  setDiscoveringProjectId: (projectId: string | null) => void;
}

export interface MutationCallbacks {
  onCommitted?: () => void;
  onFailed?: () => void;
}

const committed = (ack: CatalogAck) => ack.status === 'committed' || ack.status === 'duplicate';

/**
 * Owns the complete browser lifecycle for project/session catalog commands.
 *
 * Session archive/restore/rename persist in server SQLite and broadcast via
 * Registry projection; the browser only sends metadata mutations.
 */
export class CatalogActions {
  constructor(private readonly deps: CatalogActionsDependencies) {}

  createProject(name: string, cwd: string, instanceId?: string, callbacks: MutationCallbacks = {}): boolean {
    if (!this.canMutate('Read-only mode cannot create projects')) return false;
    const frame = H.projectCreate(name, cwd, instanceId);
    return this.sendMutation(frame, 'project/create', 'Project created', {
      title: 'Project creation result not yet confirmed',
      detail: 'The project may already have been created. Your input is preserved; wait for the sidebar to sync before resubmitting.',
    }, callbacks);
  }

  archiveProject(projectId: string, callbacks: MutationCallbacks = {}): boolean {
    if (!this.canMutate('Read-only mode cannot archive projects')) return false;
    const frame = H.projectArchive(projectId);
    return this.sendMutation(frame, 'project/archive', 'Project archived', {
      title: 'Archive result not yet confirmed',
      detail: 'The project may already be archived. Wait for the sidebar to sync before retrying.',
    }, callbacks, () => this.deps.onProjectArchived(projectId));
  }

  restoreProject(projectId: string, callbacks: MutationCallbacks = {}): boolean {
    if (!this.canMutate('Read-only mode cannot restore projects')) return false;
    const frame = H.projectRestore(projectId);
    return this.sendMutation(frame, 'project/restore', 'Project restored', {
      title: 'Restore result not yet confirmed',
      detail: 'The project may already be restored. Wait for the sidebar to sync before retrying.',
    }, callbacks);
  }

  renameProject(projectId: string, name: string, callbacks: MutationCallbacks = {}): boolean {
    if (!name.trim()) return false;
    if (!this.canMutate('Read-only mode cannot rename projects')) return false;
    const frame = H.projectRename(projectId, name.trim());
    return this.sendMutation(frame, 'project/rename', 'Project renamed', {
      title: 'Project rename result not yet confirmed',
      detail: 'The name may already be saved. Your input is preserved; wait for the sidebar to sync.',
    }, callbacks);
  }

  renameSession(sessionId: string, name: string, callbacks: MutationCallbacks = {}): boolean {
    if (!name.trim()) return false;
    if (!this.canMutate('Read-only mode cannot rename sessions')) return false;
    const frame = H.persistedSessionRename(sessionId, name.trim());
    return this.sendMutation(frame, 'session/rename', 'Session renamed', {
      title: 'Session rename result not yet confirmed',
      detail: 'The name may already be saved. Your input is preserved; wait for the sidebar to sync before retrying.',
    }, callbacks);
  }

  setSessionArchived(sessionId: string, archive: boolean, callbacks: MutationCallbacks = {}): boolean {
    if (!this.canMutate(archive ? 'Read-only mode cannot archive sessions' : 'Read-only mode cannot restore sessions')) return false;
    const frame = archive
      ? H.persistedSessionArchive(sessionId)
      : H.persistedSessionRestore(sessionId);
    return this.sendMutation(
      frame,
      archive ? 'session/archive' : 'session/restore',
      archive ? 'Session archived' : 'Session restored',
      {
        title: archive ? 'Archive result not yet confirmed' : 'Restore result not yet confirmed',
        detail: archive
          ? 'The session may already be archived. Wait for the sidebar to sync before retrying.'
          : 'The session may already be restored. Wait for the sidebar to sync before retrying.',
      },
      callbacks,
      archive ? () => this.deps.onSessionArchived(sessionId) : undefined,
    );
  }

  importSession(
    projectId: string,
    acpSessionId: string,
    onCommitted?: () => void,
    onFailed?: (kind: 'failed' | 'uncertain') => void,
  ): boolean {
    if (!this.canMutate('Read-only mode cannot import sessions')) return false;
    const frame = H.persistedSessionImport(projectId, acpSessionId);
    return this.deps.send(frame, 'session/import', {
      retryOnUncertain: true,
      cb: (ack) => {
        if (!committed(ack) || !ack.sessionId) return;
        this.deps.toast('Session added to the sidebar');
        onCommitted?.();
      },
      onError: () => onFailed?.('failed'),
      onTimeout: () => {
        this.deps.persistProblem('Import result not yet confirmed', 'The server may have imported this session. Wait for the sidebar to refresh; to confirm, retry the original request.', frame.commandId);
        onFailed?.('uncertain');
      },
    });
  }

  discoverSessions(projectId: string, onCommitted?: () => void, onFailed?: (message: string) => void): boolean {
    if (!this.deps.isReady() || this.deps.isReadOnly() || this.deps.discoveringProjectId()) {
      onFailed?.(this.deps.isReadOnly()
        ? 'Read-only mode cannot refresh ACP sessions.'
        : !this.deps.isReady()
          ? 'Connection not ready; cannot read ACP sessions yet.'
          : 'Another project is refreshing ACP sessions.');
      return false;
    }
    const frame = H.persistedSessionDiscover(projectId);
    this.deps.setDiscoveringProjectId(projectId);
    const finish = () => this.deps.setDiscoveringProjectId(null);
    return this.deps.send(frame, 'session/discover', {
      cb: (ack) => {
        if (!committed(ack)) return;
        finish();
        onCommitted?.();
      },
      onError: (error) => {
        finish();
        onFailed?.(error.message || 'Cannot read ACP sessions.');
      },
      onTimeout: () => {
        finish();
        onFailed?.('Timed out reading ACP sessions. The temporary discovery runtime will be cleaned up by the server; safe to retry.');
      },
    });
  }

  private canMutate(readOnlyMessage: string): boolean {
    if (this.deps.isReadOnly()) {
      this.deps.toast(readOnlyMessage);
      return false;
    }
    if (!this.deps.isReady()) {
      this.deps.toast('Connection not ready');
      return false;
    }
    if (this.deps.hasUncertainMetadata()) {
      this.deps.toast('Resolve pending "result not yet confirmed" project or session operations first');
      return false;
    }
    return true;
  }

  private sendMutation(
    frame: CatalogFrame,
    label: string,
    successMessage: string,
    uncertain: { title: string; detail: string },
    callbacks: MutationCallbacks,
    beforeCommitted?: () => void,
  ): boolean {
    return this.deps.send(frame, label, {
      retryOnUncertain: true,
      cb: (ack) => {
        if (!committed(ack)) return;
        beforeCommitted?.();
        this.deps.toast(successMessage);
        callbacks.onCommitted?.();
      },
      onError: () => callbacks.onFailed?.(),
      onTimeout: () => {
        this.deps.persistProblem(uncertain.title, uncertain.detail, frame.commandId);
        callbacks.onFailed?.();
      },
    });
  }
}
