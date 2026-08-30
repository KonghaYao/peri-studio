import type { JSX } from 'solid-js';
import { cn } from '@/lib/cn';

type RowAccessorySlotProps = {
  /** Tailwind group 名，例如 group/row、group/workspace。 */
  group: 'row' | 'workspace';
  meta: JSX.Element;
  actions: JSX.Element;
  actionsVisible?: boolean;
  class?: string;
};

/** 侧栏行右侧浮动槽：meta（时间/计数）与 actions（按钮组）叠层，不占文档流宽度。 */
export function RowAccessorySlot(props: RowAccessorySlotProps) {
  const actionsVisible = () => props.actionsVisible;
  const rowGroup = props.group === 'row';
  return (
    <div
      class={cn(
        'row-accessory-slot pointer-events-none absolute top-1/2 z-40 -translate-y-1/2',
        rowGroup ? 'right-1 h-6 min-w-[4.5rem]' : 'right-1 h-6 min-w-12',
        props.class,
      )}
    >
      <span
        class={cn(
          'row-accessory-slot__meta absolute inset-0 flex items-center justify-end transition-opacity duration-(--duration-fast)',
          rowGroup
            ? 'group-hover/row:opacity-0 group-focus-within/row:opacity-0'
            : 'group-hover/workspace:opacity-0 group-focus-within/workspace:opacity-0',
          'pointer-coarse:opacity-0',
          actionsVisible() && 'opacity-0',
        )}
      >
        {props.meta}
      </span>
      <div
        class={cn(
          'row-accessory-slot__actions absolute inset-0 flex items-center justify-end opacity-0 transition-opacity duration-(--duration-fast)',
          rowGroup
            ? 'group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100'
            : 'group-hover/workspace:pointer-events-auto group-hover/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto group-focus-within/workspace:opacity-100',
          'focus-within:pointer-events-auto focus-within:opacity-100',
          'pointer-coarse:pointer-events-auto pointer-coarse:opacity-100',
          actionsVisible() && 'pointer-events-auto opacity-100',
        )}
      >
        {props.actions}
      </div>
    </div>
  );
}
