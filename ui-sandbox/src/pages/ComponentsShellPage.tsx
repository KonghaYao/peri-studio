import { ComponentCatalogExtrasShell } from '@/pages/ComponentCatalogExtrasShell';
import { TierHeader } from '@/pages/shared/DemoSection';

export function ComponentsShellPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader tier="Compositions · Shell" title="Shell" />
      <ComponentCatalogExtrasShell
        sections={['project-sidebar', 'status-area', 'terminal-dock']}
      />
    </div>
  );
}
