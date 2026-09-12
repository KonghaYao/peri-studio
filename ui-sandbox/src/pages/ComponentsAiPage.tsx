import { ComponentCatalogExtrasF } from '@/pages/ComponentCatalogExtrasF';
import { ComponentCatalogExtrasG } from '@/pages/ComponentCatalogExtrasG';
import { TierHeader } from '@/pages/shared/DemoSection';

const AI_SECTIONS = [
  'conversation',
  'message',
  'suggestion',
  'sources',
  'citation',
  'plan',
  'task',
  'decision',
  'questionnaire',
  'confirmation',
  'queue',
  'snippet',
] as const;

/** T2 · Chat 原语与 AI Elements。 */
export function ComponentsAiPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 2 · AI"
        title="Chat & AI"
        description="会话滚动原语与 AI Elements；壳层组合见 #/components-shell，Markdown 见 #/components-markdown。"
      />
      <ComponentCatalogExtrasF sections={[...AI_SECTIONS]} />
      <ComponentCatalogExtrasG sections={[...AI_SECTIONS]} />
    </div>
  );
}
