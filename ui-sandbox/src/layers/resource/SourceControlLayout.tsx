import { GitBranchBar, GitChangeGroup, GitCommitBar } from '@peri/ui';
import { GitChangeTree } from '@/components/blocks/git';
import {
  DEMO_REPO,
  DEMO_STAGED,
  DEMO_UNTRACKED,
  DEMO_WORKING,
} from './git-demo-data';

/** Tier 4 · Source Control：树形变更列表，复用 FileTree。 */
export function SourceControlLayout(props: {
  embedded?: boolean;
  onPreviewPath?: (path: string) => void;
} = {}) {
  const stagedCount = () => DEMO_STAGED.length;

  return (
    <aside
      class="flex h-full w-full flex-col bg-neutral-25"
      aria-label="Source Control"
    >
      <div class="min-h-0 flex-1 overflow-auto px-4 pt-4 pb-8">
        <GitBranchBar
          repoName={DEMO_REPO.name}
          branch={DEMO_REPO.branch}
          ahead={DEMO_REPO.ahead}
          behind={DEMO_REPO.behind}
          root={DEMO_REPO.root}
          hasUpstream
        />
        <GitCommitBar stagedCount={stagedCount()} />
        <GitChangeGroup label="Staged Changes" count={DEMO_STAGED.length}>
          <GitChangeTree changes={DEMO_STAGED} groupId="index" onFileSelect={(change) => props.onPreviewPath?.(change.path)} />
        </GitChangeGroup>
        <GitChangeGroup label="Changes" count={DEMO_WORKING.length}>
          <GitChangeTree changes={DEMO_WORKING} groupId="working_tree" onFileSelect={(change) => props.onPreviewPath?.(change.path)} />
        </GitChangeGroup>
        <GitChangeGroup label="Untracked" count={DEMO_UNTRACKED.length}>
          <GitChangeTree changes={DEMO_UNTRACKED} groupId="untracked" onFileSelect={(change) => props.onPreviewPath?.(change.path)} />
        </GitChangeGroup>
      </div>
    </aside>
  );
}
