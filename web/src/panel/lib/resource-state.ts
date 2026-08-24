import type { OpenResourceView } from './resource-protocol';
import type { ResourceEntry, ResourceView } from './resource-view';

export interface DirectoryState { generation: string; entries: ResourceEntry[]; nextCursor?: string }
export interface RepositoryState {
  id: string;
  root: string;
  name: string;
  generation?: string;
  headName?: string;
  upstream?: string;
  detached?: boolean;
  ahead?: number;
  behind?: number;
  groups: Record<string, { count: number; revision: string; changes: ResourceEntry[]; sourceGeneration?: string; nextCursor?: string }>;
}
export interface ResourceWorkspaceState {
  projectId: string | null;
  directories: Record<string, DirectoryState>;
  repositories: RepositoryState[];
  loading: string[];
  error: string | null;
  mutations?: Record<string, import('./resource-mutations').GitMutationState>;
  repoMutations?: Record<string, import('./resource-mutations').GitMutationState>;
}

export interface ResourceFollowup { key: string; payload: OpenResourceView }

export const initialResourceWorkspace = (): ResourceWorkspaceState => ({
  projectId: null, directories: {}, repositories: [], loading: [], error: null,
  mutations: {}, repoMutations: {},
});

export function reduceResourceView(
  state: ResourceWorkspaceState,
  view: ResourceView,
): { state: ResourceWorkspaceState; followups: ResourceFollowup[] } {
  if (view.projectId !== state.projectId) return { state, followups: [] };
  if (view.viewType === 'fs_directory_page') {
    const path = view.path ?? '';
    return {
      state: { ...state, directories: { ...state.directories, [path]: mergeDirectoryPage(state.directories[path], view) } },
      followups: [],
    };
  }
  if (view.viewType === 'workspace_repositories_page') {
    const repositories = view.entries.map((entry) => ({
      id: String(entry.repo_id ?? entry.id), root: String(entry.root ?? ''),
      name: String(entry.name ?? 'Repository'), groups: {},
    }));
    return {
      state: { ...state, repositories },
      followups: repositories.map((repo) => ({
        key: `repository:${repo.id}`, payload: { kind: 'git-repository', repoId: repo.id },
      })),
    };
  }
  if (view.viewType === 'git_repository') {
    const repoId = view.repoId!;
    const repositories = upsertRepo(state.repositories, repoId, {
      root: String(view.meta.root ?? ''), generation: view.sourceGeneration,
      headName: stringOrUndefined(view.meta.head_name), upstream: stringOrUndefined(view.meta.upstream),
      detached: !!view.meta.detached, ahead: numberOrZero(view.meta.ahead), behind: numberOrZero(view.meta.behind),
      groups: Object.fromEntries(view.entries.map((entry) => [entry.id, {
        count: numberOrZero(entry.count), revision: String(entry.revision ?? ''), changes: [],
      }])),
    });
    return {
      state: { ...state, repositories },
      followups: view.entries.filter((group) => numberOrZero(group.count) > 0).map((group) => ({
        key: `group:${repoId}:${group.id}`,
        payload: { kind: 'git-group-page', repoId, groupId: group.id as OpenResourceView['groupId'] },
      })),
    };
  }
  const repoId = view.repoId!;
  const groupId = view.groupId!;
  return {
    state: {
      ...state,
      repositories: state.repositories.map((repo) => repo.id === repoId ? {
        ...repo, groups: { ...repo.groups, [groupId]: mergeGitPage(repo.groups[groupId], view) },
      } : repo),
    },
    followups: [],
  };
}

function mergeDirectoryPage(current: DirectoryState | undefined, view: ResourceView): DirectoryState {
  const generation = view.sourceGeneration ?? '';
  return {
    generation,
    entries: current?.generation === generation ? mergeEntries(current.entries, view.entries) : view.entries,
    nextCursor: view.nextCursor,
  };
}

function mergeGitPage(current: RepositoryState['groups'][string] | undefined, view: ResourceView) {
  const sourceGeneration = view.sourceGeneration ?? '';
  const changes = current?.sourceGeneration === sourceGeneration
    ? mergeEntries(current.changes, view.entries) : view.entries;
  return {
    count: current?.count ?? changes.length, revision: current?.revision ?? '', changes,
    sourceGeneration, nextCursor: view.nextCursor,
  };
}

function mergeEntries(current: ResourceEntry[], incoming: ResourceEntry[]): ResourceEntry[] {
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) byId.set(entry.id, entry);
  return [...byId.values()];
}

function upsertRepo(repositories: RepositoryState[], id: string, patch: Partial<RepositoryState>) {
  if (!repositories.some((repo) => repo.id === id)) {
    return [...repositories, { id, root: '', name: 'Repository', groups: {}, ...patch }];
  }
  return repositories.map((repo) => repo.id === id ? { ...repo, ...patch } : repo);
}

const stringOrUndefined = (value: unknown) => typeof value === 'string' ? value : undefined;
const numberOrZero = (value: unknown) => typeof value === 'number' ? value : Number(value) || 0;
