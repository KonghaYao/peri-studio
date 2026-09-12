import { Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  ExplorerMutationsLayout,
  ExplorerUploadDropLayout,
  ResourcePanelLayout,
  ResourceWorkbenchLayout,
} from '@/layers';
import { CatalogDemo } from '@/pages/shared/DemoSection';

export function ComponentCatalogExtrasExplorer(props: { sections?: string[] }) {
  return (
    <>
      <Show when={showCatalogSection(props.sections, 'explorer-panel')}>
      <CatalogDemo id="explorer-panel" title="File tree">
        <ResourcePanelLayout />
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'explorer-upload-drop')}>
      <CatalogDemo id="explorer-upload-drop" title="Upload drop">
        <ExplorerUploadDropLayout />
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'explorer-mutations')}>
      <CatalogDemo id="explorer-mutations" title="Mutations">
        <ExplorerMutationsLayout />
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'workbench')}>
      <CatalogDemo id="workbench" title="Workbench">
        <ResourceWorkbenchLayout />
      </CatalogDemo>
      </Show>
    </>
  );
}
