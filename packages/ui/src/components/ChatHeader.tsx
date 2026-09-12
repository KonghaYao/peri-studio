import { FileText, Menu, PanelRight } from 'lucide-solid';
import type { Component, JSX } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import { cn } from '../lib/cn';
import { IconButton } from './Button';

export type ChatHeaderProps = {
  title: string;
  launch?: boolean;
  class?: string;
  titleClass?: string;
  navButtonClass?: string;
  resourcesButtonClass?: string;
  onOpenNavigation?: () => void;
  onOpenResources?: () => void;
  /** 窄屏显示导航按钮（生产 web 用）。 */
  showMobileNav?: boolean;
  /** 窄屏显示资源按钮。 */
  showMobileResources?: boolean;
  launchTrailing?: JSX.Element;
};

/** Chat 顶栏壳层：标题 + 可选移动端导航/资源按钮。 */
export const ChatHeader: Component<ChatHeaderProps> = (props) => {
  const [local] = splitProps(props, [
    'title',
    'launch',
    'class',
    'titleClass',
    'navButtonClass',
    'resourcesButtonClass',
    'onOpenNavigation',
    'onOpenResources',
    'showMobileNav',
    'showMobileResources',
    'launchTrailing',
  ]);

  return (
    <header
      class={cn(
        'relative flex h-52 items-center gap-8 border-b border-border-subtle bg-surface-overlay px-16',
        local.launch && 'justify-end',
        local.class,
      )}
    >
      <Show when={local.showMobileNav}>
        <IconButton
          tooltipPlacement="start"
          label="Open navigation"
          size="sm"
          class={cn('max-desk:inline-flex', local.navButtonClass)}
          onClick={local.onOpenNavigation}
        >
          <Menu size={16} strokeWidth={1.7} />
        </IconButton>
      </Show>
      <Show when={!local.launch && local.showMobileResources}>
        <IconButton
          tooltipPlacement="end"
          label="Open workspace resources"
          size="sm"
          class={cn('max-desk:inline-flex', local.resourcesButtonClass)}
          onClick={local.onOpenResources}
        >
          <FileText size={16} strokeWidth={1.7} />
        </IconButton>
      </Show>
      <Show when={!local.launch}>
        <strong
          class={cn(
            'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-14 font-semibold text-content-primary',
            local.titleClass,
          )}
        >
          {local.title}
        </strong>
      </Show>
      <Show when={local.launch}>
        {local.launchTrailing ?? (
          <IconButton tooltipPlacement="end" label="Toggle side panel" title="Side panel is not connected yet" disabled class="disabled:opacity-100">
            <PanelRight size={18} strokeWidth={1.7} />
          </IconButton>
        )}
      </Show>
    </header>
  );
};
