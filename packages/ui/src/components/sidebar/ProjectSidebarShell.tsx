import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { SidebarContent, SidebarFooter, SidebarHeader } from '../sidebar-parts';
import {
  sidebarMistDividerClass,
  sidebarScrollClass,
  sidebarScrollMistClass,
  sidebarScrollShellClass,
} from './sidebar-layout';

export type ProjectSidebarShellProps = {
  class?: string;
  navbar?: JSX.Element;
  body: JSX.Element;
  footer?: JSX.Element;
  /** 由外层 `Sidebar` 包裹时仅渲染内层槽位。 */
  embedded?: boolean;
  'data-testid'?: string;
  'aria-label'?: string;
};

/** T3 · Project 侧栏布局壳：navbar + 可滚动 body（云雾裁切）+ 可选 footer。 */
export const ProjectSidebarShell: Component<ProjectSidebarShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'navbar',
    'body',
    'footer',
    'embedded',
  ]);

  const regions = (
    <>
      <Show when={local.navbar}>
        <SidebarHeader class="shrink-0 gap-0 border-0 p-0 px-6 pt-8 pb-4">
          {local.navbar}
        </SidebarHeader>
      </Show>
      <div class={cn(sidebarScrollShellClass, 'px-6')}>
        <SidebarContent class={cn(sidebarScrollClass, 'min-h-0 h-full gap-0 overflow-auto p-0 pb-8')}>
          {local.body}
        </SidebarContent>
        <div class={sidebarScrollMistClass} aria-hidden="true" />
      </div>
      <Show when={local.footer}>
        <div class={sidebarMistDividerClass} aria-hidden="true" />
        <SidebarFooter class="sidebar-footer flex h-48 shrink-0 flex-row items-center gap-8 border-0 p-0 px-10">
          {local.footer}
        </SidebarFooter>
      </Show>
    </>
  );

  if (local.embedded) {
    return regions;
  }

  return (
    <nav
      {...rest}
      class={cn(
        'ui-project-sidebar-shell project-sidebar flex min-h-0 flex-col text-content-primary',
        local.class,
      )}
      aria-label={rest['aria-label'] ?? 'Projects and sessions'}
    >
      {regions}
    </nav>
  );
};
