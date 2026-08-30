import { For } from 'solid-js';
import { GitBranchBar, GitChangeGroup, GitChangeTree, GitCommitBar } from '@/components/blocks/git';
import { cn } from '@/lib/cn';
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
      class="flex h-full w-full flex-col bg-surface-overlay"
      aria-label="Source Control"
    >
      <div class={cn('min-h-0 flex-1 overflow-auto pb-2', props.embedded ? 'px-1 pt-1' : 'px-1.5 pt-2')}>
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
          <GitChangeTree changes={DEMO_STAGED} groupId="index" onFileSelect={props.onPreviewPath} />
        </GitChangeGroup>
        <GitChangeGroup label="Changes" count={DEMO_WORKING.length}>
          <GitChangeTree changes={DEMO_WORKING} groupId="working_tree" onFileSelect={props.onPreviewPath} />
        </GitChangeGroup>
        <GitChangeGroup label="Untracked" count={DEMO_UNTRACKED.length}>
          <GitChangeTree changes={DEMO_UNTRACKED} groupId="untracked" onFileSelect={props.onPreviewPath} />
        </GitChangeGroup>
      </div>
    </aside>
  );
}
