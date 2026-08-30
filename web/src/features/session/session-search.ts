import type { ProjectInfo, ProjectSessionInfo } from '../../panel/lib/registry-view';

export interface ProjectSessionSearchResult extends ProjectSessionInfo {
  project: ProjectInfo | null;
}

const normalized = (value: unknown): string => String(value || '').normalize('NFKC').toLocaleLowerCase().trim();

export const searchProjectSessions = (
  query: string,
  projects: ProjectInfo[],
  sessions: ProjectSessionInfo[],
): ProjectSessionSearchResult[] => {
  const needle = normalized(query);
  if (!needle) return [];
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return sessions
    .filter((session) => {
      const project = projectById.get(session.projectId);
      return [session.title, session.id, project?.name, project?.cwd]
        .some((value) => normalized(value).includes(needle));
    })
    .map((session) => ({ ...session, project: projectById.get(session.projectId) || null }))
    .sort((a, b) => String(b.lastOpenedAt || b.updatedAt || '').localeCompare(String(a.lastOpenedAt || a.updatedAt || '')))
    .slice(0, 50);
};
