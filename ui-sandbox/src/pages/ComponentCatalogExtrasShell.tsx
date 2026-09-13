import { Show } from 'solid-js';
import { Terminal } from '@peri/ui';
import { showCatalogSection } from '@/catalog/catalog-section';
import { ProjectSidebarLayout } from '@/layers/shell/ProjectSidebarLayout';
import { MonitorPanelLayout } from '@/layers/shell/MonitorPanelLayout';
import { SettingsPanelLayout } from '@/layers/shell/SettingsPanelLayout';
import { SystemAboutLayout } from '@/layers/shell/SystemAboutLayout';
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

      <Show when={showCatalogSection(props.sections, 'monitor-panel')}>
      <CatalogDemo
        id="monitor-panel"
        title="Monitor panel"
        description="Langfuse trace summary + list (T3 MonitorPanelShell). Workbench rail entry when /api/health.langfuse is true."
      >
        <MonitorPanelLayout />
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'settings-panel')}>
      <CatalogDemo
        id="settings-panel"
        title="Settings panel"
        description="macOS 式左导航 + 右详情大窗（T3 SettingsPanel）。Appearance：材质色板 + Opacity。System 诊断仍是独立 Tabs 弹窗。"
      >
        <SettingsPanelLayout />
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'system-about')}>
      <CatalogDemo
        id="system-about"
        title="System About"
        description="This browser 安装态：Chrome 可安装、已安装 standalone / window-controls-overlay、loopback Safari A2HS、Cannot install here。已安装但 WCO 未 overlay 时提示 Reinstall the app to hide the window title bar。齿轮 Settings 菜单含 Install + System；首次登录 Dialog 为 Chrome Install / iOS A2HS 说明。"
      >
        <SystemAboutLayout />
      </CatalogDemo>
      </Show>
    </>
  );
}
