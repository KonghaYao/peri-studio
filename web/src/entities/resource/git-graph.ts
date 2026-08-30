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
  shortHash?: string;
  refs?: GitGraphRef[];
  isHead?: boolean;
  /** Parent commit hashes (git log order: parents are older commits). */
  parents?: string[];
};
