import type { ProjectInfo, ProjectSessionInfo } from '@/entities/registry/registry-view';

export type ArchivedProjectEntry = {
  kind: 'project';
  id: string;
  title: string;
  subtitle: string;
  sortAt: string;
  project: ProjectInfo;
};

export type ArchivedSessionEntry = {
  kind: 'session';
  id: string;
  title: string;
  subtitle: string;
  sortAt: string;
  session: ProjectSessionInfo;
  project: ProjectInfo | null;
};

export type ArchivedEntry = ArchivedProjectEntry | ArchivedSessionEntry;

const normalized = (value: unknown): string =>
  String(value || '').normalize('NFKC').toLocaleLowerCase().trim();

function projectEntry(project: ProjectInfo, sessionCount: number): ArchivedProjectEntry {
  return {
    kind: 'project',
    id: `project:${project.id}`,
    title: project.name,
    subtitle: `${sessionCount} session${sessionCount === 1 ? '' : 's'}`,
    sortAt: project.archivedAt || project.updatedAt || '',
    project,
  };
}

function sessionEntry(session: ProjectSessionInfo, project: ProjectInfo | null): ArchivedSessionEntry {
  return {
    kind: 'session',
    id: `session:${session.id}`,
    title: session.title || session.id,
    subtitle: `${project?.name || 'Unknown project'} · Session`,
    sortAt: session.archivedAt || session.updatedAt || '',
    session,
    project,
  };
}

/** 列出全部归档项目与会话，按归档/更新时间倒序。 */
export function listArchivedEntries(
  projects: ProjectInfo[],
  sessions: ProjectSessionInfo[],
): ArchivedEntry[] {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const entries: ArchivedEntry[] = [
    ...projects
      .filter((project) => !!project.archivedAt)
      .map((project) => projectEntry(
        project,
        sessions.filter((session) => session.projectId === project.id).length,
      )),
    ...sessions
      .filter((session) => !!session.archivedAt)
      .map((session) => sessionEntry(session, projectById.get(session.projectId) || null)),
  ];
  return entries
    .sort((left, right) => right.sortAt.localeCompare(left.sortAt))
    .slice(0, 100);
}

/** 在归档集合内按标题、项目名、路径或 ID 过滤；可按 project 限定会话归档。 */
export function searchArchivedEntries(
  query: string,
  projects: ProjectInfo[],
  sessions: ProjectSessionInfo[],
  options?: { projectId?: string },
): ArchivedEntry[] {
  const needle = normalized(query);
  let entries = listArchivedEntries(projects, sessions);
  if (options?.projectId) {
    entries = entries.filter((entry) => entry.kind === 'session' && entry.session.projectId === options.projectId);
  }
  if (!needle) return entries;
  return entries.filter((entry) => {
    const haystack = entry.kind === 'project'
      ? [entry.title, entry.project.id, entry.project.cwd]
      : [entry.title, entry.session.id, entry.project?.name, entry.project?.cwd];
    return haystack.some((value) => normalized(value).includes(needle));
  });
}
