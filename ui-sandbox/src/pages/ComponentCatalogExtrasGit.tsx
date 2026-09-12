import { Show } from 'solid-js';
import {
  GitBranchBar,
  GitChangeGroup,
  GitChangeTree,
  GitCommitBar,
  GitDiffPanel,
  GitGraphPanel,
} from '@/components/blocks';
import { showCatalogSection } from '@/catalog/catalog-section';
import { GitGraphLayout, SourceControlLayout } from '@/layers';
import { CatalogDemo } from '@/pages/shared/DemoSection';

const GIT_FRAME = 'h-(--workbench-frame-height) overflow-hidden rounded-lg border border-border-subtle';

const GIT_GRAPH_COMMITS = [
  {
    id: 'row-1',
    hash: 'a4f2c91b',
    message: 'feat(web): add git graph layout to ui sandbox',
    author: 'Christopher13',
    time: '2m',
    date: '30 Aug 2026',
    parents: ['8be31d04'],
    refs: [{ label: 'main', tone: 'branch' as const }, { label: 'HEAD', tone: 'branch' as const }],
    isHead: true,
  },
  {
    id: 'row-2',
    hash: '8be31d04',
    message: 'fix(resource): retry git mutations after generation bump',
    author: 'Christopher13',
    time: '18m',
    date: '30 Aug 2026',
    parents: ['c17e902a'],
    refs: [{ label: 'feature/scm', tone: 'branch' as const }],
  },
  {
    id: 'row-3',
    hash: 'c17e902a',
    message: 'feat(resource): source control panel with stage groups',
    author: 'Christopher13',
    time: '1h',
    date: '30 Aug 2026',
    parents: ['f3bbdffa'],
  },
];

export function ComponentCatalogExtrasGit(props: { sections?: string[] }) {
  return (
    <>
      <Show when={showCatalogSection(props.sections, 'source-control')}>
      <CatalogDemo id="source-control" title="Source control">
        <div class={`${GIT_FRAME} max-w-sm`}>
          <SourceControlLayout />
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'git-graph')}>
      <CatalogDemo id="git-graph" title="Git graph">
        <div class={`${GIT_FRAME} w-full`}>
          <GitGraphLayout />
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'git-change-row')}>
      <CatalogDemo id="git-change-row" title="Git change tree">
        <div class="max-w-sm rounded-lg border border-border-subtle bg-surface-overlay py-4">
          <GitChangeGroup label="Changes" count={2}>
            <GitChangeTree
              groupId="working_tree"
              changes={[
                { id: 'demo-1', path: 'web/src/widgets/resource/SourceControlPanel.tsx', status: 'modified' },
                { id: 'demo-2', path: 'docs/design/remote-fs-git-protocol.md', status: 'modified' },
              ]}
            />
          </GitChangeGroup>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'git-commit-bar')}>
      <CatalogDemo id="git-commit-bar" title="Git commit bar">
        <div class="max-w-sm rounded-lg border border-border-subtle bg-surface-overlay py-4">
          <GitBranchBar repoName="peri-studio" branch="main" ahead={2} behind={0} hasUpstream />
          <GitCommitBar stagedCount={1} />
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'git-graph-row')}>
      <CatalogDemo id="git-graph-row" title="Git graph panel">
        <div class="h-(--demo-frame-git-graph) overflow-hidden rounded-lg border border-border-subtle">
          <GitGraphPanel commits={GIT_GRAPH_COMMITS} />
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'git-diff-panel')}>
      <CatalogDemo id="git-diff-panel" title="Git diff panel">
        <div class="max-w-md rounded-lg border border-border-subtle">
          <GitDiffPanel path="web/src/widgets/resource/SourceControlPanel.tsx" class="min-h-210" />
        </div>
      </CatalogDemo>
      </Show>
    </>
  );
}
