import type { JSX } from 'solid-js';
import { cn } from '../lib/cn';

/** 分段按钮组容器：侧栏行 hover 操作、紧凑工具栏（对齐 ui-sandbox ButtonGroup）。 */
export function ButtonGroup(props: { class?: string; 'aria-label'?: string; children: JSX.Element }) {
  return (
    <div
      role="group"
      aria-label={props['aria-label']}
      class={cn(
        'ui-button-group inline-flex items-center overflow-hidden rounded-md bg-transparent',
        props.class,
      )}
    >
      {props.children}
    </div>
  );
}

/** ButtonGroup 内单个图标按钮的统一样式（禁止圆角与段间分隔线）。 */
export const buttonGroupItemClass =
  'size-28 shrink-0 rounded-none border-0 bg-transparent shadow-none hover:bg-interaction-hover pointer-coarse:min-h-44 pointer-coarse:min-w-44';
