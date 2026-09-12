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
