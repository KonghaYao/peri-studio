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

export type GitGraphRef = {
  label: string;
  tone?: 'branch' | 'remote' | 'tag';
};

export type GitGraphCommit = {
  id: string;
  message: string;
  author: string;
  time: string;
  date?: string;
  hash?: string;
  refs?: GitGraphRef[];
  isHead?: boolean;
  /** Parent commit hashes (git log order: parents are older commits). */
  parents?: string[];
};
