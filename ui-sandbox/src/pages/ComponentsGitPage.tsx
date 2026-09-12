import { ComponentCatalogExtrasGit } from '@/pages/ComponentCatalogExtrasGit';
import { TierHeader } from '@/pages/shared/DemoSection';

export function ComponentsGitPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader tier="Compositions · Git" title="Git" />
      <ComponentCatalogExtrasGit
        sections={[
          'source-control',
          'git-graph',
          'git-change-row',
          'git-commit-bar',
          'git-graph-row',
          'git-diff-panel',
        ]}
      />
    </div>
  );
}
