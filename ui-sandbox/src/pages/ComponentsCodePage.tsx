import { ComponentCatalogExtrasCode } from '@/pages/ComponentCatalogExtrasCode';
import { TierHeader } from '@/pages/shared/DemoSection';

/** T2 · CodeBlock 与语法高亮。 */
export function ComponentsCodePage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader tier="Tier 2 · Code" title="CodeBlock" />
      <ComponentCatalogExtrasCode
        sections={[
          'code-block-default',
          'code-block-composable',
          'code-block-line-numbers',
        ]}
      />
    </div>
  );
}
