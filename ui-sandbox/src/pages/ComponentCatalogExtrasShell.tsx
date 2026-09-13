import { Show } from 'solid-js';
import { Terminal } from '@peri/ui';
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

      <Show when={showCatalogSection(props.sections, 'terminal-xterm')}>
      <CatalogDemo id="terminal-xterm" title="Terminal" description="xterm.js 视口原语（T2）；Terminal dock 为 T3 壳层。">
        <Terminal class="h-160 rounded-8 border border-border-subtle" />
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
