import { ComponentCatalogExtras } from '@/pages/ComponentCatalogExtras';
import { ComponentCatalogExtrasLayout } from '@/pages/ComponentCatalogExtrasLayout';
import { ComponentCatalogExtrasB } from '@/pages/ComponentCatalogExtrasB';
import { ComponentCatalogExtrasC } from '@/pages/ComponentCatalogExtrasC';
import { ComponentCatalogExtrasD } from '@/pages/ComponentCatalogExtrasD';
import { ComponentCatalogExtrasE } from '@/pages/ComponentCatalogExtrasE';
import { ComponentCatalogFeedback } from '@/pages/ComponentCatalogFeedback';
import { TierHeader } from '@/pages/shared/DemoSection';

/** T2 · 表面、浮层与导航：Card、Sheet、菜单、侧栏、轮播等。 */
export function ComponentsOverlaysPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 2 · Overlays"
        title="Surfaces & navigation"
        description="内容容器、浮层、菜单导航与布局原语。"
      />
      <ComponentCatalogExtras sections={['accordion']} />
      <ComponentCatalogExtrasD sections={['item']} />
      <ComponentCatalogExtras sections={['progress']} />
      <ComponentCatalogExtrasB sections={['overlay', 'menus']} />
      <ComponentCatalogExtras sections={['popover-toast']} />
      <ComponentCatalogExtrasE sections={['drawer']} />
      <ComponentCatalogExtrasB sections={['breadcrumb']} />
      <ComponentCatalogExtrasC sections={['menubar']} />
      <ComponentCatalogExtrasD sections={['carousel']} />
      <ComponentCatalogExtrasE sections={['direction']} />
      <ComponentCatalogExtrasB sections={['sidebar']} />
      <ComponentCatalogExtrasLayout
        sections={['flex', 'grid', 'layout', 'space', 'masonry', 'affix', 'anchor', 'steps', 'back-to-top', 'float-button']}
      />
      <ComponentCatalogFeedback sections={[
        'message',
        'notification',
        'popconfirm',
        'result',
        'watermark',
        'upload',
        'alert-types',
        'button-variants',
        'progress-circle',
        'slider-marks',
        'editable-tabs',
        'dialog-methods',
        'toast-enhanced',
      ]} />
    </div>
  );
}
