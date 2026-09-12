import { ComponentCatalogExtrasMarkdown } from '@/pages/ComponentCatalogExtrasMarkdown';
import { TierHeader } from '@/pages/shared/DemoSection';

/** T2 · Markdown 渲染与 CodeBlock 语法高亮。 */
export function ComponentsMarkdownPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader tier="Tier 2 · Markdown" title="Markdown & Code" />
      <ComponentCatalogExtrasMarkdown
        sections={[
          'markdown-render',
          'code-block-default',
          'code-block-composable',
          'code-block-line-numbers',
        ]}
      />
    </div>
  );
}
