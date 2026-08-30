import * as H from '../../panel/lib/protocol';
import type { ProjectSessionInfo } from '@/entities/registry/registry-view';
import { SessionNavigator, type OpeningSession, type SessionNavigationEffect, type SessionNavigationSnapshot } from './session-navigator';
import {
  acceptQuickStart,
  completeQuickStart,
  failQuickStart,
  finishQuickStart,
  markQuickStartUncertain,
  quickStartSubmission,
  resetQuickStart,
  retryQuickStartDelivery,
  startQuickStart,
} from '../../panel/lib/quick-start-delivery';
import { promptFitsBudget } from '../../panel/lib/prompt-budget';

type ActionFrame = ReturnType<typeof H.action>;
export interface ActivationAck {
  commandId?: string;
  status?: string;
  sessionId?: string;
  chatId?: string;
}
export interface ActivationError { message?: string; retryable?: boolean }
export interface ActivationSendOptions {
  cb?: (ack: ActivationAck) => void;
  onAccepted?: (ack: ActivationAck) => void;
  onTimeout?: () => void;
  onError?: (error: ActivationError) => void;
  retryOnUncertain?: boolean;
}
export interface OpenSessionCallbacks {
  onCommitted?: () => void;
  onFailed?: (message: string) => void;
  onUncertain?: () => void;
}

export interface SessionActivationDependencies {
  isReady: () => boolean;
  isReadOnly: () => boolean;
  hasUncertainMetadata: () => boolean;
  hasMessageSubmission: () => boolean;
  creatingProjectId: () => string | null;
  setCreatingProjectId: (projectId: string | null) => void;
  sessions: () => ProjectSessionInfo[];
  selectedSessionId: () => string | null;
  currentChatId: () => string | null;
  preferredSessionId: () => string | null;
  send: (frame: ActionFrame, label: string, options: ActivationSendOptions) => boolean;
  retry: (commandId: string) => 'sent' | 'missing' | 'already_pending' | 'unavailable';
  hasUncertainCommand: (commandId: string) => boolean;
  activate: (sessionId: string, chatId: string) => void;
  forgetPreference: () => void;
  sendFirstMessage: (text: string) => boolean;
  preserveFirstMessage: (projectId: string, sessionId: string, text: string) => boolean;
  maxPromptBytes: () => number;
  onNavigationChange: (snapshot: SessionNavigationSnapshot) => void;
  toast: (message: string) => void;
  persistProblem: (title: string, detail: string, commandId?: string) => void;
}

const isCommitted = (ack: ActivationAck) => ack.status === 'committed' || ack.status === 'duplicate';

/**
 * Owns logical-session activation policy across create, quick start, restore and open.
 * Transport, persistence UI and actual chat subscription remain injected effects.
 */
export class SessionActivation {
  private readonly navigator: SessionNavigator;

  constructor(private readonly deps: SessionActivationDependencies) {
    this.navigator = new SessionNavigator(deps.onNavigationChange);
  }

  create(projectId: string, title?: string): boolean {
    const rejection = this.creationRejection();
    if (rejection) {
      this.deps.toast(rejection);
      return false;
    }
    const frame = H.persistedSessionCreate(projectId, title);
    this.deps.setCreatingProjectId(projectId);
    const finish = () => this.deps.setCreatingProjectId(null);
    return this.deps.send(frame, 'session/create', {
      retryOnUncertain: true,
      cb: (ack) => {
        if (!isCommitted(ack)) return;
        finish();
        if (!ack.sessionId || !ack.chatId) {
          this.deps.persistProblem(
            'Incomplete create-session reply',
            'The server committed the operation but did not return both the logical session and runtime identities. The view was not switched to avoid entering the wrong session; wait for the sidebar projection to sync.',
            frame.commandId,
          );
          return;
        }
        this.applyEffects(this.navigator.transition({ type: 'local-select', sessionId: ack.sessionId, chatId: ack.chatId }));
      },
      onError: finish,
      onTimeout: () => {
        finish();
        this.deps.persistProblem('Create-session result not yet confirmed', 'The session may have been created. Wait for the sidebar to sync and do not click New again immediately.', frame.commandId);
      },
    });
  }

  quickStart(projectId: string, text: string): boolean {
    const source = text.trim();
    if (!source || quickStartSubmission() || this.deps.hasMessageSubmission() || this.deps.creatingProjectId()) return false;
    const rejection = this.mutationRejection();
    if (rejection) {
      this.deps.toast(rejection);
      return false;
    }
    if (!promptFitsBudget(source, this.deps.maxPromptBytes())) {
      const maxBytes = this.deps.maxPromptBytes();
      this.deps.toast(maxBytes > 0
        ? `First message exceeds the negotiated ${maxBytes} byte limit`
        : 'Secure message delivery is not enabled on the server');
      return false;
    }
    const firstLine = source.split(/\r?\n/, 1)[0];
    const title = [...firstLine].slice(0, 60).join('');
    const frame = H.persistedSessionCreate(projectId, title);
    if (!startQuickStart(frame.commandId, projectId, source)) return false;
    return this.deps.send(frame, 'session/create', {
      retryOnUncertain: true,
      onAccepted: () => acceptQuickStart(frame.commandId),
      cb: (ack) => {
        const activation = completeQuickStart(frame.commandId, ack.status, ack.sessionId, ack.chatId);
        if (!activation) return;
        this.deps.activate(activation.sessionId, activation.chatId);
        if (this.deps.sendFirstMessage(activation.text)) {
          finishQuickStart(activation.commandId);
        } else if (this.deps.preserveFirstMessage(activation.projectId, activation.sessionId, activation.text)) {
          finishQuickStart(activation.commandId);
          // 错误中心不落用户原文（原则 4：敏感信息不得进入日志/持久化）。
          // 原文已进入 principal/project/session 复合键草稿；这里只写引导文案。
          this.deps.persistProblem(
            'First message not yet sent',
            'The session was created but the first message was not submitted. Reopen the session from the sidebar and resend.',
            activation.commandId,
          );
        } else {
          failQuickStart(activation.commandId, 'The session was created, but the first message could not be attached to its persistent draft identity. Copy it from this recovery card before continuing.');
        }
      },
      onTimeout: () => markQuickStartUncertain(frame.commandId),
      onError: (error) => failQuickStart(frame.commandId, error.message || 'Failed to create the session. Your message is still kept.'),
    });
  }

  retryQuickStart(): void {
    const current = quickStartSubmission();
    if (!current || current.phase !== 'uncertain' || !this.deps.hasUncertainCommand(current.commandId)) return;
    if (!this.deps.isReady()) {
      this.deps.toast('Connection not ready, cannot re-confirm yet');
      return;
    }
    if (this.deps.retry(current.commandId) === 'sent') retryQuickStartDelivery(current.commandId);
    else this.deps.toast('Connection not ready, the original request is still kept');
  }

  navigate(sessionId: string, callbacks: OpenSessionCallbacks = {}): boolean {
    const session = this.deps.sessions().find((item) => item.id === sessionId);
    if (!session || session.archivedAt || session.lifecycle !== 'ready') {
      callbacks.onFailed?.('Session is not ready yet');
      return false;
    }
    if (this.deps.isReadOnly()) {
      if (!session.activeChatId) {
        callbacks.onFailed?.('Read-only mode can only open sessions that are already running');
        return false;
      }
      this.applyEffects(this.navigator.transition({ type: 'local-select', sessionId: session.id, chatId: session.activeChatId }));
      callbacks.onCommitted?.();
      return true;
    }
    return this.open(session.id, callbacks);
  }

  reconcileCatalog(sessions: ProjectSessionInfo[]): void {
    this.applyEffects(this.navigator.transition({
      type: 'catalog',
      ready: this.deps.isReady(),
      readOnly: this.deps.isReadOnly(),
      preferredId: this.deps.preferredSessionId(),
      selectedSessionId: this.deps.selectedSessionId(),
      sessions: sessions.filter((session) => !session.archivedAt),
    }));
  }

  connectionLost(): void { this.applyEffects(this.navigator.transition({ type: 'connection-lost' })); }

  /** Re-bind the current logical session after reconnect (server restart safe). */
  reactivateAfterReconnect(): void {
    const sessionId = this.deps.selectedSessionId();
    if (!sessionId) return;
    this.navigate(sessionId);
  }

  reset(): void {
    resetQuickStart();
    this.deps.setCreatingProjectId(null);
    this.applyEffects(this.navigator.transition({ type: 'reset' }));
  }

  private open(sessionId: string, callbacks: OpenSessionCallbacks = {}): boolean {
    const rejection = this.openRejection();
    if (rejection) {
      this.deps.toast(rejection);
      callbacks.onFailed?.(rejection);
      return false;
    }
    const frame = H.persistedSessionOpen(sessionId);
    this.navigator.transition({
      type: 'open-started',
      commandId: frame.commandId,
      sessionId,
      previousSessionId: this.deps.selectedSessionId(),
      previousChatId: this.deps.currentChatId(),
    });
    return this.deps.send(frame, 'session/open', {
      cb: (ack) => {
        const effects = this.navigator.transition({ type: 'open-terminal', commandId: ack.commandId, status: ack.status, chatId: ack.chatId });
        if (!effects.length) return;
        this.applyEffects(effects);
        callbacks.onCommitted?.();
      },
      onError: (error) => {
        this.navigator.transition({ type: 'open-failed', commandId: frame.commandId });
        callbacks.onFailed?.(error.message || 'Failed to open the session');
      },
      onTimeout: () => {
        this.navigator.transition({ type: 'open-uncertain', commandId: frame.commandId });
        this.deps.persistProblem('Open result not yet confirmed', 'The current session was not switched. Wait for the sidebar state to sync; if the session is still not running, open it again.', frame.commandId);
        callbacks.onUncertain?.();
      },
    });
  }

  private mutationRejection(): string | null {
    if (this.deps.isReadOnly()) return 'Read-only mode cannot create sessions';
    if (!this.deps.isReady()) return 'Connection not ready';
    if (this.deps.hasUncertainMetadata()) return 'Resolve pending "result not yet confirmed" project or session operations first';
    return null;
  }

  private creationRejection(): string | null {
    const rejection = this.mutationRejection();
    if (rejection) return rejection;
    if (this.deps.creatingProjectId() || quickStartSubmission()) return 'A session is already being created';
    return null;
  }

  private openRejection(): string | null {
    if (this.deps.isReadOnly()) return 'Read-only mode cannot open running sessions';
    if (!this.deps.isReady()) return 'Connection not ready';
    if (this.navigator.snapshot().opening) return 'Another session is already opening';
    if (this.deps.hasUncertainMetadata()) return 'Confirm the previous operation first';
    return null;
  }

  private applyEffects(effects: SessionNavigationEffect[]): void {
    for (const effect of effects) {
      if (effect.type === 'request-open') this.open(effect.sessionId);
      if (effect.type === 'activate') this.deps.activate(effect.sessionId, effect.chatId);
      if (effect.type === 'forget-preference') this.deps.forgetPreference();
    }
  }
}

export type { OpeningSession };
