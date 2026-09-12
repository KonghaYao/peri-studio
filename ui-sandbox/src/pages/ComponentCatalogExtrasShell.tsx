import { Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import { ProjectSidebarLayout } from '@/layers/shell/ProjectSidebarLayout';
import { StatusAreaLayout } from '@/layers/status/StatusAreaLayout';
import { TerminalDockLayout } from '@/layers/terminal/TerminalDockLayout';
import { CatalogDemo } from '@/pages/shared/DemoSection';

export function ComponentCatalogExtrasShell(props: { sections?: string[] }) {
  return (
    <>
      <Show when={showCatalogSection(props.sections, 'project-sidebar')}>
      <CatalogDemo id="project-sidebar" title="Project sidebar">
        <ProjectSidebarLayout />
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'status-area')}>
      <CatalogDemo id="status-area" title="Status area">
        <StatusAreaLayout />
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'terminal-dock')}>
      <CatalogDemo id="terminal-dock" title="Terminal dock">
        <TerminalDockLayout />
      </CatalogDemo>
      </Show>
    </>
  );
}
