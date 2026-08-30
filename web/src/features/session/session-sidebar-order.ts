import type { ProjectSessionInfo } from '../../panel/lib/registry-view';

/** Sidebar recency: explicit open time first, then ACP updatedAt, then stable id. */
export const compareSessionsForSidebar = (
  left: ProjectSessionInfo,
  right: ProjectSessionInfo,
): number => {
  const leftStamp = left.lastOpenedAt || left.updatedAt || '';
  const rightStamp = right.lastOpenedAt || right.updatedAt || '';
  const byStamp = rightStamp.localeCompare(leftStamp);
  if (byStamp !== 0) return byStamp;
  return left.id.localeCompare(right.id);
};

const sameFields = (left: ProjectSessionInfo, right: ProjectSessionInfo): boolean => {
  const keys = Object.keys(right) as Array<keyof ProjectSessionInfo>;
  return keys.length === Object.keys(left).length && keys.every((key) => left[key] === right[key]);
};

const reconcileSession = (
  previous: ProjectSessionInfo | undefined,
  incoming: ProjectSessionInfo,
): ProjectSessionInfo => (previous && sameFields(previous, incoming) ? previous : incoming);

function groupByProject(sessions: readonly ProjectSessionInfo[]): Map<string, ProjectSessionInfo[]> {
  const grouped = new Map<string, ProjectSessionInfo[]>();
  for (const session of sessions) {
    const bucket = grouped.get(session.projectId);
    if (bucket) bucket.push(session);
    else grouped.set(session.projectId, [session]);
  }
  return grouped;
}

function projectOrder(
  previous: readonly ProjectSessionInfo[],
  incoming: readonly ProjectSessionInfo[],
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const session of previous) {
    if (seen.has(session.projectId)) continue;
    seen.add(session.projectId);
    order.push(session.projectId);
  }
  for (const session of incoming) {
    if (seen.has(session.projectId)) continue;
    seen.add(session.projectId);
    order.push(session.projectId);
  }
  return order;
}

function reconcileProjectSessionsForProject(
  previous: readonly ProjectSessionInfo[],
  incoming: ProjectSessionInfo[],
): ProjectSessionInfo[] {
  if (!previous.length) return [...incoming].sort(compareSessionsForSidebar);

  const incomingById = new Map(incoming.map((session) => [session.id, session]));
  const previousById = new Map(previous.map((session) => [session.id, session]));

  const bumped = incoming
    .filter((session) => {
      const prior = previousById.get(session.id);
      return prior && (session.lastOpenedAt || '') > (prior.lastOpenedAt || '');
    })
    .map((session) => reconcileSession(previousById.get(session.id), session))
    .sort(compareSessionsForSidebar);

  const bumpedIds = new Set(bumped.map((session) => session.id));
  const stable: ProjectSessionInfo[] = [];
  for (const prior of previous) {
    if (bumpedIds.has(prior.id)) continue;
    const next = incomingById.get(prior.id);
    if (!next) continue;
    stable.push(reconcileSession(prior, next));
  }

  const placed = new Set([...bumped, ...stable].map((session) => session.id));
  const newcomers = incoming
    .filter((session) => !placed.has(session.id))
    .map((session) => reconcileSession(previousById.get(session.id), session))
    .sort(compareSessionsForSidebar);

  return [...bumped, ...newcomers, ...stable];
}

/**
 * Keeps sidebar session order stable across registry polls that reshuffle by
 * volatile ACP `updatedAt`, while still surfacing newly opened sessions.
 */
export function stabilizeProjectSessionOrder(
  previous: readonly ProjectSessionInfo[],
  incoming: ProjectSessionInfo[],
): ProjectSessionInfo[] {
  if (!previous.length) return [...incoming].sort(compareSessionsForSidebar);

  const previousByProject = groupByProject(previous);
  const incomingByProject = groupByProject(incoming);
  const reconciled: ProjectSessionInfo[] = [];

  for (const projectId of projectOrder(previous, incoming)) {
    reconciled.push(
      ...reconcileProjectSessionsForProject(
        previousByProject.get(projectId) ?? [],
        incomingByProject.get(projectId) ?? [],
      ),
    );
  }

  return reconciled.length === previous.length
    && reconciled.every((session, index) => session === previous[index])
    ? previous as ProjectSessionInfo[]
    : reconciled;
}
