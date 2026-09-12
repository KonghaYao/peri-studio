import { ComponentCatalogExtras } from '@/pages/ComponentCatalogExtras';
import { ComponentCatalogExtrasB } from '@/pages/ComponentCatalogExtrasB';
import { ComponentCatalogExtrasC } from '@/pages/ComponentCatalogExtrasC';
import { ComponentCatalogExtrasD } from '@/pages/ComponentCatalogExtrasD';
import { ComponentCatalogExtrasE } from '@/pages/ComponentCatalogExtrasE';
import { CatalogNotImplemented, TierHeader } from '@/pages/shared/DemoSection';

/** T2 · 表面、浮层与导航：Card、Sheet、菜单、侧栏、轮播等。 */
export function ComponentsOverlaysPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 2 · Overlays"
        title="Surfaces & navigation"
        description="内容容器、对话框/抽屉、菜单导航与轮播。"
      />
      <ComponentCatalogExtras sections={['progress', 'card', 'accordion', 'table']} />
      <ComponentCatalogExtrasB sections={['breadcrumb', 'overlay', 'menus']} />
      <ComponentCatalogExtrasC sections={['menubar']} />
      <ComponentCatalogExtrasD sections={['carousel', 'item']} />
      <ComponentCatalogExtrasE sections={['empty', 'drawer', 'direction']} />
      <CatalogNotImplemented
        id="sidebar"
        title="Sidebar"
        description="shadcn 应用壳侧栏原语（Provider、折叠、Cmd/Ctrl+B）。"
        reason="T2 `@peri/ui` Sidebar 暂不实现。产品侧栏组合见 T4 Layers · Project sidebar。"
      />
    </div>
  );
}
