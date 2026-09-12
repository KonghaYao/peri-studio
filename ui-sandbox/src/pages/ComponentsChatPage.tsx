import { ComponentCatalogExtrasF } from '@/pages/ComponentCatalogExtrasF';
import { TierHeader } from '@/pages/shared/DemoSection';

/** T2 · 会话滚动原语；Transcript / Composer 见 Blocks / AI / Layers。 */
export function ComponentsChatPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 2 · Chat"
        title="Chat primitives"
        description="MessageScroller 与 Message 分支；气泡 / Markdown / 工具活动 / Composer 见 #/blocks、#/components-ai 与 #/layers。"
      />
      <ComponentCatalogExtrasF />
    </div>
  );
}
