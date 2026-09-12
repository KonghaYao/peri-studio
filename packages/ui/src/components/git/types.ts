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

export type GitGraphRefTone = 'branch' | 'remote' | 'tag';

export type GitGraphRef = {
  label: string;
  tone?: GitGraphRefTone;
};

export type GitGraphCommit = {
  id: string;
  message: string;
  author: string;
  time: string;
  date?: string;
  hash?: string;
  shortHash?: string;
  refs?: GitGraphRef[];
  isHead?: boolean;
  /** Parent commit hashes (git log order: parents are older commits). */
  parents?: string[];
  parentsComplete?: boolean;
  refsComplete?: boolean;
};

export type GitGraphActionKind =
  | 'checkout'
  | 'create-branch'
  | 'rename-branch'
  | 'reset'
  | 'revert';

export type GitResetMode = 'soft' | 'mixed' | 'hard';

export interface GitGraphActionParams {
  targetOid?: string;
  refName?: string;
  newRefName?: string;
  resetMode?: GitResetMode;
}
