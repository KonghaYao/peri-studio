import { ComponentCatalogExtrasF } from '@/pages/ComponentCatalogExtrasF';
import { TierHeader } from '@/pages/shared/DemoSection';

/** T2 · shadcn 聊天原语：MessageScroller、Bubble、Tool、Composer 等。 */
export function ComponentsChatPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 2 · Chat"
        title="Chat primitives"
        description="shadcn 2026-06 聊天组件与 Peri 流式会话 UI 原语。"
      />
      <ComponentCatalogExtrasF />
    </div>
  );
}
