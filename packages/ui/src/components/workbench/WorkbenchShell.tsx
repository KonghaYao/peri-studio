import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

export type WorkbenchShellProps = {
  class?: string;
  compact?: boolean;
  rail: JSX.Element;
  panel?: JSX.Element;
  panelOpen?: boolean;
  children?: JSX.Element;
  'aria-label'?: string;
};

/** T3 · Workbench 轨 + 可选浮动面板槽；T4 通过 `children` 追加额外面板（如 Terminal）。 */
export const WorkbenchShell: Component<WorkbenchShellProps> = (props) => {
  const [local] = splitProps(props, [
    'class',
    'compact',
    'rail',
    'panel',
    'panelOpen',
    'children',
    'aria-label',
  ]);

  return (
    <aside
      class={cn(
        'ui-workbench-shell',
        local.compact && 'ui-workbench-shell--compact',
        local.class,
      )}
      aria-label={local['aria-label'] ?? 'Workspace resources'}
    >
      {local.rail}
      {local.children}
      <Show when={local.panelOpen && local.panel}>{local.panel}</Show>
    </aside>
  );
};
