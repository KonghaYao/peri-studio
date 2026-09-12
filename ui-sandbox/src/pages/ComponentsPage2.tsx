import { ComponentCatalogExtras } from '@/pages/ComponentCatalogExtras';
import { ComponentCatalogExtrasB } from '@/pages/ComponentCatalogExtrasB';
import { ComponentCatalogExtrasC } from '@/pages/ComponentCatalogExtrasC';
import { ComponentCatalogExtrasD } from '@/pages/ComponentCatalogExtrasD';
import { ComponentCatalogExtrasE } from '@/pages/ComponentCatalogExtrasE';
import { TierHeader } from '@/pages/shared/DemoSection';

/** T2 · Base UI 扩展页：第二批及后续 shadcn 对齐组件的展示矩阵。 */
export function ComponentsPage2() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 2 · Base UI 2"
        title="Extended components"
        description="扩展原语与导航/布局类组件：Switch、Sheet、Combobox、Menubar 等。新一轮 shadcn 补齐组件在此页追加 demo。"
      />
      <ComponentCatalogExtras />
      <ComponentCatalogExtrasB />
      <ComponentCatalogExtrasC />
      <ComponentCatalogExtrasD />
      <ComponentCatalogExtrasE />
    </div>
  );
}
