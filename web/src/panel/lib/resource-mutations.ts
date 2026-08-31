import { gitResourceAction, type GitActionKind, type GitGraphActionPayload } from './resource-protocol';
import { isGitGraphAction, validateGitGraphAction } from '@/features/resource/git-graph-mutations';

export const MAX_COMMIT_MESSAGE_BYTES = 4_096;

export interface GitMutationState {
  requestId: string;
  repoId: string;
  action: GitActionKind;
  changeIds: string[];
  message?: string;
  scope: 'change' | 'repository';
  pending: boolean;
  error?: string;
  retryable?: boolean;
}

export interface MutationWorkspace {
  projectId: string | null;
  repositories: Array<{ id: string; generation?: string }>;
  mutations?: Record<string, GitMutationState>;
  repoMutations?: Record<string, GitMutationState>;
}

type UpdateWorkspace<T extends MutationWorkspace> = (update: (state: T) => T) => void;

export class GitMutationController {
  private readonly pending = new Map<string, GitMutationState>();

  start<T extends MutationWorkspace>(input: {
    state: T;
    repoId: string;
    action: GitActionKind;
    changeIds?: string[];
    message?: string;
    graph?: GitGraphActionPayload;
    ready: boolean;
    send: (frame: unknown) => boolean;
    update: UpdateWorkspace<T>;
    setLoading: (key: string, loading: boolean) => void;
  }): boolean {
    const changeIds = input.changeIds ?? [];
    const repo = input.state.repositories.find((item) => item.id === input.repoId);
    const repositoryAction = ['commit', 'pull', 'push', 'sync', 'checkout', 'create-branch', 'rename-branch', 'reset', 'revert'].includes(input.action);
    const normalizedMessage = input.action === 'commit' ? input.message?.trim() : undefined;
    if (!input.state.projectId || !input.ready || !repo?.generation) return false;
    if (repositoryAction === (changeIds.length > 0)) return false;
    if (input.action === 'commit' && (!normalizedMessage || new TextEncoder().encode(normalizedMessage).byteLength > MAX_COMMIT_MESSAGE_BYTES)) return false;
    if (isGitGraphAction(input.action) && (!input.graph || !validateGitGraphAction(input.action, input.graph))) return false;
    if (!isGitGraphAction(input.action) && input.graph) return false;
    if (input.state.repoMutations?.[input.repoId]?.pending
      || Object.values(input.state.mutations ?? {}).some((mutation) => mutation.repoId === input.repoId && mutation.pending)) return false;
    const frame = gitResourceAction(input.state.projectId, input.repoId, input.action, changeIds, repo.generation, normalizedMessage, input.graph);
    if (!input.send(frame)) return false;
    const mutation: GitMutationState = {
      requestId: frame.requestId, repoId: input.repoId, action: input.action, changeIds,
      message: normalizedMessage, scope: repositoryAction ? 'repository' : 'change', pending: true,
    };
    this.pending.set(frame.requestId, mutation);
    input.setLoading(`mutation:${input.repoId}`, true);
    input.update((current) => ({
      ...current,
      mutations: repositoryAction ? current.mutations : { ...current.mutations, ...Object.fromEntries(changeIds.map((id) => [id, mutation])) },
      repoMutations: repositoryAction ? { ...current.repoMutations, [input.repoId]: mutation } : current.repoMutations,
    }));
    return true;
  }

  take(requestId: string): GitMutationState | undefined {
    const mutation = this.pending.get(requestId);
    this.pending.delete(requestId);
    return mutation;
  }

  fail<T extends MutationWorkspace>(mutation: GitMutationState, error: { message: string; retryable: boolean }, update: UpdateWorkspace<T>): void {
    const failed = { ...mutation, pending: false, error: error.message, retryable: error.retryable };
    update((state) => ({
      ...state,
      mutations: mutation.scope === 'change'
        ? { ...state.mutations, ...Object.fromEntries(mutation.changeIds.map((id) => [id, failed])) }
        : state.mutations,
      repoMutations: mutation.scope === 'repository'
        ? { ...state.repoMutations, [mutation.repoId]: failed }
        : state.repoMutations,
    }));
  }

  succeed<T extends MutationWorkspace>(mutation: GitMutationState, update: UpdateWorkspace<T>): void {
    update((state) => {
      const mutations = { ...state.mutations };
      for (const id of mutation.changeIds) delete mutations[id];
      const repoMutations = { ...state.repoMutations };
      delete repoMutations[mutation.repoId];
      return { ...state, mutations, repoMutations };
    });
  }

  clear(): void {
    this.pending.clear();
  }
}
