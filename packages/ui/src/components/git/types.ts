export type GitGraphRefTone = 'branch' | 'remote' | 'tag';

export type GitGraphRef = {
  label: string;
  tone?: GitGraphRefTone;
};
