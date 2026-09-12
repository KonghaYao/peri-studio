import { ComponentCatalogExtrasG } from '@/pages/ComponentCatalogExtrasG';
import { TierHeader } from '@/pages/shared/DemoSection';

/** T2 · AI Elements：引用、计划、代码块、Typeset 等 AI SDK 对齐组件。 */
export function ComponentsAiPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 2 · AI"
        title="AI Elements"
        description="AI Elements API + blocks 视觉契约；Markdown 与 Blocks 共用同一渲染块。"
      />
      <ComponentCatalogExtrasG
        sections={[
          'suggestion',
          'sources',
          'citation',
          'plan',
          'task',
          'reasoning',
          'confirmation',
          'queue',
          'code-block',
          'snippet',
          'markdown',
        ]}
      />
    </div>
  );
}
