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
  const hoverGroup = () => (props.group === 'row' ? 'group-hover/row' : 'group-hover/workspace');
  const focusGroup = () => (props.group === 'row' ? 'group-focus-within/row' : 'group-focus-within/workspace');
  const actionsVisible = () => props.actionsVisible;
  return (
    <div
      class={cn(
        'row-accessory-slot pointer-events-none absolute right-1 top-1/2 z-1 h-6 min-w-12 -translate-y-1/2',
        props.class,
      )}
    >
      <span
        class={cn(
          'absolute inset-0 flex items-center justify-end transition-opacity duration-(--duration-fast)',
          `${hoverGroup()}:opacity-0 ${focusGroup()}:opacity-0`,
          actionsVisible() && 'opacity-0',
        )}
      >
        {props.meta}
      </span>
      <div
        class={cn(
          'absolute inset-0 flex items-center justify-end opacity-0 transition-opacity duration-(--duration-fast)',
          `${hoverGroup()}:pointer-events-auto ${hoverGroup()}:opacity-100`,
          `${focusGroup()}:pointer-events-auto ${focusGroup()}:opacity-100`,
          'focus-within:pointer-events-auto focus-within:opacity-100',
          actionsVisible() && 'pointer-events-auto opacity-100',
        )}
      >
        {props.actions}
      </div>
    </div>
  );
}
