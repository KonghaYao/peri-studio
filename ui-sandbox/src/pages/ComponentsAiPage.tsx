import { ComponentCatalogExtrasF } from '@/pages/ComponentCatalogExtrasF';
import { ComponentCatalogExtrasG } from '@/pages/ComponentCatalogExtrasG';
import { TierHeader } from '@/pages/shared/DemoSection';

const AI_SECTIONS = [
  'conversation',
  'message',
  'chat-shell',
  'chat-transcript',
  'chat-header',
  'session-row-accessory',
  'project-row-accessory',
  'suggestion',
  'sources',
  'citation',
  'plan',
  'task',
  'decision',
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
        description="会话滚动、壳层块与 AI Elements；Markdown 见 #/components-markdown，Composer 见 #/components-composer。"
      />
      <ComponentCatalogExtrasF sections={[...AI_SECTIONS]} />
      <ComponentCatalogExtrasG sections={[...AI_SECTIONS]} />
    </div>
  );
}
