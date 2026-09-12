import { ComponentCatalogExtrasG } from '@/pages/ComponentCatalogExtrasG';
import { TierHeader } from '@/pages/shared/DemoSection';

/** T2 · AI Elements：引用、计划、代码块、Typeset 等 AI SDK 对齐组件。 */
export function ComponentsAiPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 2 · AI"
        title="AI Elements"
        description="Vercel AI Elements 对齐组件：Suggestion、Plan、CodeBlock、Typeset 等。"
      />
      <ComponentCatalogExtrasG sections={['suggestion', 'sources', 'citation', 'plan', 'task', 'confirmation', 'queue', 'code-block', 'snippet', 'typeset']} />
    </div>
  );
}
