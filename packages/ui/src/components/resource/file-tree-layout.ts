/** Explorer / SCM 文件树行 drop target 高亮。 */
export const fileTreeDropTargetRowClass = 'bg-interaction-hover';

/** Explorer / SCM 文件树 drop 指示条。 */
export const fileTreeDropAccentClass =
  'pointer-events-none absolute top-1/2 h-16 w-3 -translate-y-1/2 rounded-2 bg-accent-solid';

/** 文件树滚动容器（禁用 overflow anchor 避免虚拟化跳动）。 */
export const fileTreeScrollClass = 'overflow-anchor-none';

/** Explorer 根节点 upload drop 高亮。 */
export const fileTreeDropRootClass =
  'outline-2 outline-dashed outline-accent-border-hover outline-offset-2';

/** 行内重命名 / 新建输入框。 */
export const fileTreeInlineNameInputClass =
  'm-0 border-0 bg-transparent p-0 font-inherit leading-inherit text-inherit outline-none caret-content-primary focus-visible:outline-none';

/** 行内编辑器校验错误提示。 */
export const fileTreeInlineNameErrorClass =
  'pointer-events-none absolute top-full left-0 z-1 pt-2 text-11 leading-tight text-danger-solid';

/** 行内编辑器无效态描边。 */
export const fileTreeInlineRowInvalidClass = 'outline-1 outline-danger-border outline-offset-neg-1';
