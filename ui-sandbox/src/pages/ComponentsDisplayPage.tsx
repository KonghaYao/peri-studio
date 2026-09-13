import { ComponentCatalogExtrasDisplay } from '@/pages/ComponentCatalogExtrasDisplay';
import { TierHeader } from '@/pages/shared/DemoSection';

const DISPLAY_SECTIONS = [
  'descriptions',
  'image',
  'list',
  'qr-code',
  'segmented',
  'statistic',
  'tag',
  'timeline',
  'tour',
  'badge',
  'avatar-display',
  'card-display',
  'empty',
  'skeleton-display',
  'typography-display',
  'pagination-display',
] as const;

export function ComponentsDisplayPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 2 · Data display"
        title="Data display"
        description="Ant Design–aligned descriptions, media, lists, tags, and enhanced badge/card/empty/skeleton/typography/pagination."
      />
      <ComponentCatalogExtrasDisplay sections={[...DISPLAY_SECTIONS]} />
    </div>
  );
}
