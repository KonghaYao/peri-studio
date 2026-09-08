export type AuthFeedbackKind = 'network' | 'credential' | 'origin' | 'request' | 'rate' | 'server';

export interface AuthFeedback {
  kind: AuthFeedbackKind;
  message: string;
  retryable: boolean;
}

export function authFeedback(status: number, phase: 'login' | 'status' = 'login'): AuthFeedback | null {
  if (status === 0) return { kind: 'network', message: 'Cannot reach the Peri Studio server. Make sure the local service is running.', retryable: true };
  if (status === 401) {
    if (phase === 'status') return null;
    return { kind: 'credential', message: 'The token is invalid, revoked, or not a client token usable in the browser.', retryable: false };
  }
  if (status === 403) return { kind: 'origin', message: 'The page origin is not allowed by the server. Open the panel from the local address the server provides.', retryable: false };
  if (status === 408) return { kind: 'network', message: 'Authentication request timed out. Check the server status and retry.', retryable: true };
  if (status === 413) return { kind: 'request', message: 'The token payload is malformed or exceeds the length the server accepts.', retryable: false };
  if (status === 429) return { kind: 'rate', message: 'Too many authentication attempts. Try again later.', retryable: true };
  if (status >= 500) return { kind: 'server', message: 'The server cannot complete authentication right now; this does not mean the token is invalid.', retryable: true };
  return { kind: 'request', message: `Authentication request failed (HTTP ${status}).`, retryable: true };
}
