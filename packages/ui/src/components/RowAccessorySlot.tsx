import type { Component, JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../lib/cn';

export type RowAccessorySlotProps = {
  /** Tailwind group 名，例如 group/row、group/workspace。 */
  group: 'row' | 'workspace';
  meta: JSX.Element;
  actions: JSX.Element;
  actionsVisible?: boolean;
  class?: string;
};

const rowCoverBg =
  'bg-surface group-data-[selected=true]/row:bg-sidebar-selected group-hover/row:bg-sidebar-row-hover group-focus-within/row:bg-sidebar-row-hover';
const workspaceCoverBg =
  'bg-surface group-hover/workspace:bg-sidebar-row-hover group-focus-within/workspace:bg-sidebar-row-hover';

/** 侧栏行右侧浮动槽：meta（live/unread/计数）与 actions（按钮组）叠层，不占文档流宽度。 */
export const RowAccessorySlot: Component<RowAccessorySlotProps> = (props) => {
  const [local] = splitProps(props, ['group', 'meta', 'actions', 'actionsVisible', 'class']);
  const actionsVisible = () => local.actionsVisible;
  const rowGroup = () => local.group === 'row';

  const metaHidden = () => cn(
    rowGroup()
      ? 'group-hover/row:invisible group-hover/row:opacity-0 group-focus-within/row:invisible group-focus-within/row:opacity-0'
      : 'group-hover/workspace:invisible group-hover/workspace:opacity-0 group-focus-within/workspace:invisible group-focus-within/workspace:opacity-0',
    'pointer-coarse:invisible pointer-coarse:opacity-0',
    actionsVisible() && 'invisible opacity-0',
  );

  const actionsShown = () => cn(
    rowGroup()
      ? 'group-hover/row:visible group-hover/row:opacity-100 group-hover/row:pointer-events-auto group-focus-within/row:visible group-focus-within/row:opacity-100 group-focus-within/row:pointer-events-auto'
      : 'group-hover/workspace:visible group-hover/workspace:opacity-100 group-hover/workspace:pointer-events-auto group-focus-within/workspace:visible group-focus-within/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto',
    'focus-within:visible focus-within:opacity-100 focus-within:pointer-events-auto',
    'pointer-coarse:visible pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto',
    actionsVisible() && 'visible opacity-100 pointer-events-auto',
  );

  return (
    <div
      class={cn(
        'row-accessory-slot pointer-events-none absolute inset-y-0 right-0 z-40',
        local.class,
      )}
    >
      <span
        class={cn(
          'row-accessory-slot__meta absolute inset-y-0 right-0 flex items-center justify-end pr-4',
          metaHidden(),
        )}
      >
        {local.meta}
      </span>
      <div
        class={cn(
          'row-accessory-slot__actions absolute inset-y-0 right-0 flex items-center justify-end pl-12 pr-4',
          rowGroup() ? rowCoverBg : workspaceCoverBg,
          'invisible opacity-0 pointer-events-none',
          actionsShown(),
        )}
      >
        {local.actions}
      </div>
    </div>
  );
};
