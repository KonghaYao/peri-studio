import { connectionProblemForClose, type ConnectionProblem } from './recovery-state.ts';

export interface ConnectionPresentation {
  ready: boolean;
  busy: boolean;
  status: { text: string; kind: 'idle' | 'ok' | 'warn' | 'err' };
  problem: ConnectionProblem | null;
}

export interface ConnectionTransitionDetail {
  retryMs?: number;
  code?: number;
}

/**
 * One authoritative presentation/gating transition for a WebSocket lifecycle
 * event. Domain effects (settling commands, resubscribing, clearing auth) stay
 * in the store; callers cannot independently reinterpret readiness and UI.
 */
export function connectionTransition(
  state: string,
  detail: ConnectionTransitionDetail = {},
  hasPrincipal = false,
): ConnectionPresentation | null {
  switch (state) {
    case 'connecting':
      return { ready: false, busy: true, status: { text: 'Connecting…', kind: 'idle' }, problem: null };
    case 'open':
      return { ready: false, busy: true, status: { text: 'Authenticated', kind: 'ok' }, problem: null };
    case 'ready':
      return { ready: true, busy: false, status: { text: 'Ready', kind: 'ok' }, problem: null };
    case 'reconnecting':
      return {
        ready: false,
        busy: true,
        status: { text: `Reconnecting (in ${Math.round((detail.retryMs || 0) / 1000)}s)`, kind: 'warn' },
        problem: null,
      };
    case 'fatal':
      return {
        ready: false,
        busy: false,
        status: { text: `Stopped (${detail.code ?? 'unknown'})`, kind: 'err' },
        problem: connectionProblemForClose(detail.code),
      };
    case 'closed':
      return {
        ready: false,
        busy: false,
        status: { text: 'Disconnected', kind: 'idle' },
        problem: hasPrincipal
          ? { code: null, title: 'Connection lost', detail: 'This page is not connected to the Peri Studio server. Your persistent sessions remain safe.', action: 'reconnect' }
          : null,
      };
    case 'heartbeat':
      return null;
    default:
      return null;
  }
}
