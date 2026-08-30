export type GitChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflict';

export type GitChangeGroupId = 'conflicts' | 'index' | 'working_tree' | 'untracked';

export type GitChange = {
  id: string;
  path: string;
  status: GitChangeStatus;
};

export type { GitGraphCommit, GitGraphRef } from '@/entities/resource/git-graph';
