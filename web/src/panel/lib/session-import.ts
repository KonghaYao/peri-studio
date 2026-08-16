import type { ProjectSessionInfo, SessionSummaryInfo } from './registry-view';

export function unimportedSessions(sessions: SessionSummaryInfo[], projectSessions: ProjectSessionInfo[]): SessionSummaryInfo[] {
  const imported = new Set(projectSessions.map((session) => session.acpSessionId).filter(Boolean));
  return sessions.filter((candidate) => !imported.has(candidate.sessionId));
}

export function importCandidates(sessions: SessionSummaryInfo[], cwd: string): SessionSummaryInfo[] {
  return sessions.filter((candidate) => candidate.cwd === cwd);
}
