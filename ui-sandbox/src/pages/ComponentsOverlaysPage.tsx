import { ComponentCatalogExtras } from '@/pages/ComponentCatalogExtras';
import { ComponentCatalogExtrasB } from '@/pages/ComponentCatalogExtrasB';
import { ComponentCatalogExtrasC } from '@/pages/ComponentCatalogExtrasC';
import { ComponentCatalogExtrasD } from '@/pages/ComponentCatalogExtrasD';
import { ComponentCatalogExtrasE } from '@/pages/ComponentCatalogExtrasE';
import { TierHeader } from '@/pages/shared/DemoSection';

/** T2 · 表面、浮层与导航：Card、Sheet、菜单、侧栏、轮播等。 */
export function ComponentsOverlaysPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 2 · Overlays"
        title="Surfaces & navigation"
        description="内容容器、对话框/抽屉、菜单导航与应用壳侧栏。"
      />
      <ComponentCatalogExtras sections={['progress', 'card', 'accordion', 'table']} />
      <ComponentCatalogExtrasB sections={['breadcrumb', 'overlay', 'menus']} />
      <ComponentCatalogExtrasC sections={['menubar']} />
      <ComponentCatalogExtrasD sections={['carousel', 'item']} />
      <ComponentCatalogExtrasE sections={['empty', 'drawer', 'sidebar', 'direction']} />
    </div>
  );
}
