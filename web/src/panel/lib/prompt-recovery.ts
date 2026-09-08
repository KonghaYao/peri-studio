import type { PromptStatusItem } from '@/shared/protocol/client';

export interface PromptRecoveryView {
  sessionId: string;
  loading: boolean;
  refreshing: boolean;
  checkedAt: string | null;
  truncated: boolean;
  evidenceIncomplete: boolean;
  error: string | null;
  prompts: PromptStatusItem[];
}

export type PromptRecoveryQueryMatch = 'current' | 'stale' | null;

interface IssuedQuery { sessionId: string; expiresAt: number }

/** Fences the read-only recovery projection by its exact command and session. */
export class PromptRecoveryQueryGate {
  private current: { commandId: string; sessionId: string } | null = null;
  private readonly issued = new Map<string, IssuedQuery>();

  constructor(
    private readonly ttlMs: number,
    private readonly capacity = 64,
  ) {}

  begin(commandId: string, sessionId: string, now = Date.now()): void {
    this.prune(now);
    this.issued.set(commandId, { sessionId, expiresAt: now + this.ttlMs });
    this.current = { commandId, sessionId };
    while (this.issued.size > this.capacity) {
      const oldest = this.issued.keys().next().value as string | undefined;
      if (!oldest) break;
      this.issued.delete(oldest);
    }
  }

  classify(commandId: string | undefined, sessionId?: string, now = Date.now()): PromptRecoveryQueryMatch {
    if (!commandId) return null;
    this.prune(now);
    const issued = this.issued.get(commandId);
    if (!issued || (sessionId !== undefined && issued.sessionId !== sessionId)) return null;
    return this.current?.commandId === commandId && this.current.sessionId === issued.sessionId
      ? 'current'
      : 'stale';
  }

  isCurrent(commandId: string, sessionId: string): boolean {
    return this.current?.commandId === commandId && this.current.sessionId === sessionId;
  }

  hasCurrentFor(sessionId: string): boolean { return this.current?.sessionId === sessionId; }

  timeout(commandId: string): void {
    if (this.current?.commandId === commandId) this.current = null;
  }

  cancelCurrent(): void { this.current = null; }

  finish(commandId: string): void {
    this.issued.delete(commandId);
    if (this.current?.commandId === commandId) this.current = null;
  }

  reset(): void {
    this.current = null;
    this.issued.clear();
  }

  private prune(now: number): void {
    for (const [commandId, query] of this.issued) {
      if (query.expiresAt <= now) {
        this.issued.delete(commandId);
        if (this.current?.commandId === commandId) this.current = null;
      }
    }
  }
}

export function beginPromptRecovery(previous: PromptRecoveryView | null, sessionId: string): PromptRecoveryView {
  if (previous?.sessionId !== sessionId) {
    return { sessionId, loading: true, refreshing: false, checkedAt: null, truncated: false, evidenceIncomplete: false, error: null, prompts: [] };
  }
  return { ...previous, loading: false, refreshing: true, error: null };
}

export function failPromptRecovery(previous: PromptRecoveryView | null, sessionId: string, error: string): PromptRecoveryView {
  const owned = previous?.sessionId === sessionId ? previous : beginPromptRecovery(null, sessionId);
  return { ...owned, loading: false, refreshing: false, error };
}

export interface PromptRecoveryResponse {
  sessionId: string;
  truncated: boolean;
  evidenceIncomplete: boolean;
  prompts: PromptStatusItem[];
}

export function completePromptRecovery(response: PromptRecoveryResponse, checkedAt: string): PromptRecoveryView {
  return { ...response, loading: false, refreshing: false, checkedAt, error: null };
}

/** Deterministic, body-free evidence suitable for support or manual comparison. */
export function promptRecoveryDiagnostic(recovery: PromptRecoveryView): string {
  return JSON.stringify({
    sessionId: recovery.sessionId,
    checkedAt: recovery.checkedAt,
    truncated: recovery.truncated,
    evidenceIncomplete: recovery.evidenceIncomplete,
    prompts: recovery.prompts.map(({ commandId, turnId, status, createdAt, updatedAt, errorCode }) => ({
      commandId,
      ...(turnId ? { turnId } : {}),
      status,
      createdAt,
      updatedAt,
      ...(errorCode ? { errorCode } : {}),
    })),
  }, null, 2);
}
