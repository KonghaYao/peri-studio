import { ComponentCatalogExtrasComposer } from '@/pages/ComponentCatalogExtrasComposer';
import { TierHeader } from '@/pages/shared/DemoSection';

export function ComponentsComposerPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader tier="Compositions · Composer" title="Composer" />
      <ComponentCatalogExtrasComposer
        sections={['composer', 'composer-upload', 'slash-menu', 'token-usage']}
      />
    </div>
  );
}
