import { ComponentCatalogExtrasDisplay } from '@/pages/ComponentCatalogExtrasDisplay';
import { ComponentCatalogExtrasDataTableToolbar } from '@/pages/ComponentCatalogExtrasDataTableToolbar';
import { ComponentCatalogExtrasTableCells } from '@/pages/ComponentCatalogExtrasTableCells';
import { ComponentCatalogExtrasTableState } from '@/pages/ComponentCatalogExtrasTableState';
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
  'json-tree',
  'stat-chip',
  'token-usage-badge',
  'truncated-id-cell',
  'local-iso-date',
  'table-cells-composed',
  'table-filters',
  'level-counts-display',
  'table-loading-rows',
  'table-inline-error',
  'table-state-composed',
  'data-table-toolbar',
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
      <ComponentCatalogExtrasTableCells sections={[...DISPLAY_SECTIONS]} />
      <ComponentCatalogExtrasTableState sections={[...DISPLAY_SECTIONS]} />
      <ComponentCatalogExtrasDataTableToolbar sections={[...DISPLAY_SECTIONS]} />
    </div>
  );
}
