import { ComponentCatalogExtrasCode } from '@/pages/ComponentCatalogExtrasCode';
import { TierHeader } from '@/pages/shared/DemoSection';

/** T2 · CodeBlock 与语法高亮。 */
export function ComponentsCodePage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 2 · Code"
        title="CodeBlock"
        description="代码块容器、组合式 header 与 Shiki 语法高亮；Markdown 内嵌渲染见 #/components-ai · Markdown。"
      />
      <ComponentCatalogExtrasCode
        sections={[
          'code-block-default',
          'code-block-composable',
          'code-block-highlight',
          'code-block-line-numbers',
        ]}
      />
    </div>
  );
}
