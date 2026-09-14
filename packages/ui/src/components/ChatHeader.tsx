import { FileText, Menu } from 'lucide-solid';
import type { Component, JSX } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import { asAccessor, type MaybeAccessor } from '../lib/maybe-accessor';
import { cn } from '../lib/cn';
import { IconButton } from './Button';

export type ChatHeaderProps = {
  title: MaybeAccessor<string>;
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
  const title = () => asAccessor(props.title)();
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
      data-testid="titlebar-drag-chat"
      class={cn(
        /* WCO 几何由单一 .ui-titlebar 承担；本块只铺进 overlay 矩形，不再自增高或铺白底。 */
        'ui-titlebar-drag relative flex h-52 items-center gap-8 border-b border-border-subtle pl-titlebar-content',
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
      <strong
        class={cn(
          'ui-titlebar-no-drag min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-14 font-semibold text-content-primary',
          local.titleClass,
        )}
      >
        {title()}
      </strong>
      <Show when={local.launchTrailing}>{local.launchTrailing}</Show>
    </header>
  );
};
