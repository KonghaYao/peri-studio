import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';

export type WorkbenchRailButtonProps = {
  label: string;
  active?: boolean;
  badge?: number;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  /** 激活指示条相对 rail 内侧的位置。 */
  indicatorSide?: 'left' | 'right';
  /** catalog 演示用全宽；desktop 为生产 rail 方钮。 */
  layout?: 'catalog' | 'desktop';
  onClick: () => void;
  children: JSX.Element;
  class?: string;
};

/** T3 · Workbench 竖轨方钮：徽标、pressed 态与内侧 accent 指示条。 */
export const WorkbenchRailButton: Component<WorkbenchRailButtonProps> = (props) => {
  const [local] = splitProps(props, [
    'label',
    'active',
    'badge',
    'disabled',
    'tone',
    'indicatorSide',
    'layout',
    'onClick',
    'children',
    'class',
  ]);
  const indicatorSide = () => local.indicatorSide ?? 'left';
  const layout = () => local.layout ?? 'desktop';

  return (
    <IconButton
      label={local.label}
      showTooltip={false}
      aria-pressed={local.active}
      disabled={local.disabled}
      onClick={local.onClick}
      class={cn(
        'ui-workbench-rail-button relative rounded-md border-0 bg-transparent',
        layout() === 'catalog'
          ? 'w-full min-h-36'
          : 'w-40 min-h-38 pointer-coarse:w-48 pointer-coarse:min-h-44',
        local.tone === 'danger'
          ? 'text-danger hover:text-danger'
          : 'text-content-muted hover:text-content-primary hover:bg-interaction-hover',
        local.active && 'bg-sidebar-selected text-content-primary',
        local.active && indicatorSide() === 'left' && 'ui-workbench-rail-button--active-left',
        local.active && indicatorSide() === 'right' && 'ui-workbench-rail-button--active-right',
        local.class,
      )}
    >
      {local.children}
      <Show when={(local.badge ?? 0) > 0}>
        <span class="ui-workbench-rail-button__badge">
          {local.badge! > 99 ? '99+' : local.badge}
        </span>
      </Show>
    </IconButton>
  );
};
