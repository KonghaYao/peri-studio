import type { ProjectSessionInfo } from '../../panel/lib/registry-view';
import {
  getSessionPreference,
  type SessionPreferenceKey,
} from './session-preferences';

export function applySessionPreferences(
  sessions: ProjectSessionInfo[],
  principalId: string | null,
): ProjectSessionInfo[] {
  if (!principalId) return sessions;
  return sessions.map((session) => {
    const pref = getSessionPreference({
      principalId,
      projectId: session.projectId,
      acpSessionId: session.id,
    });
    if (!pref) return session;
    return {
      ...session,
      title: pref.customName ?? session.title,
      archivedAt: pref.archived ? pref.archivedAt ?? null : null,
    };
  });
}

export function resolveSessionPreferenceKey(
  sessionId: string,
  sessions: readonly ProjectSessionInfo[],
  principalId: string | null,
): SessionPreferenceKey | null {
  if (!principalId) return null;
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return null;
  return { principalId, projectId: session.projectId, acpSessionId: session.id };
}
