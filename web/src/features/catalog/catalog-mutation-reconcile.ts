import type { ProjectInfo, ProjectSessionInfo } from '@/entities/registry/registry-view';

export type CatalogMutationFrame = {
  commandId: string;
  type: string;
  payload: Record<string, unknown>;
};

const CATALOG_MUTATION_TYPES = new Set([
  'project/archive',
  'project/restore',
  'project/rename',
  'session/archive',
  'session/restore',
  'session/rename',
]);

function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

/** 目录 mutation 的意图是否已被 registry 投影证实。 */
export function catalogMutationProjected(
  frame: CatalogMutationFrame,
  projects: readonly ProjectInfo[],
  sessions: readonly ProjectSessionInfo[],
): boolean {
  switch (frame.type) {
    case 'project/archive': {
      const projectId = readString(frame.payload, 'projectId');
      return !!projects.find((project) => project.id === projectId)?.archivedAt;
    }
    case 'project/restore': {
      const projectId = readString(frame.payload, 'projectId');
      const project = projects.find((item) => item.id === projectId);
      return !!project && !project.archivedAt;
    }
    case 'project/rename': {
      const projectId = readString(frame.payload, 'projectId');
      const name = readString(frame.payload, 'name').trim();
      return projects.find((project) => project.id === projectId)?.name === name;
    }
    case 'session/archive': {
      const sessionId = readString(frame.payload, 'sessionId');
      return !!sessions.find((session) => session.id === sessionId)?.archivedAt;
    }
    case 'session/restore': {
      const sessionId = readString(frame.payload, 'sessionId');
      const session = sessions.find((item) => item.id === sessionId);
      return !!session && !session.archivedAt;
    }
    case 'session/rename': {
      const sessionId = readString(frame.payload, 'sessionId');
      const name = readString(frame.payload, 'name').trim();
      return sessions.find((session) => session.id === sessionId)?.title === name;
    }
    default:
      return false;
  }
}

export function reconcileCatalogMutations(
  projects: readonly ProjectInfo[],
  sessions: readonly ProjectSessionInfo[],
  uncertain: readonly CatalogMutationFrame[],
  dismissByCommandId: (commandId: string) => boolean,
): boolean {
  let changed = false;
  for (const frame of uncertain) {
    if (!CATALOG_MUTATION_TYPES.has(frame.type)) continue;
    if (!catalogMutationProjected(frame, projects, sessions)) continue;
    if (dismissByCommandId(frame.commandId)) changed = true;
  }
  return changed;
}
