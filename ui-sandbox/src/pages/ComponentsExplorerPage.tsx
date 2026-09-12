import { ComponentCatalogExtrasExplorer } from '@/pages/ComponentCatalogExtrasExplorer';
import { TierHeader } from '@/pages/shared/DemoSection';

export function ComponentsExplorerPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader tier="Compositions · Explorer" title="Explorer" />
      <ComponentCatalogExtrasExplorer
        sections={[
          'explorer-panel',
          'explorer-upload-drop',
          'explorer-mutations',
          'workbench',
        ]}
      />
    </div>
  );
}
