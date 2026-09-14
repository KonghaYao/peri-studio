import { Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import { DataTableToolbarLayout } from '@/layers/shell/DataTableToolbarLayout';
import { CatalogDemo } from '@/pages/shared/DemoSection';

/** Display catalog · DataTable toolbar + auto-refresh T3 演示。 */
export function ComponentCatalogExtrasDataTableToolbar(props: { sections?: string[] }) {
  return (
    <>
      <Show when={showCatalogSection(props.sections, 'data-table-toolbar')}>
        <CatalogDemo
          id="data-table-toolbar"
          title="DataTable toolbar"
          description="Toolbar slot, column visibility menu, and auto-refresh cadence（自 peri-fuse data-table / auto-refresh-control）。"
        >
          <DataTableToolbarLayout />
        </CatalogDemo>
      </Show>
    </>
  );
}
