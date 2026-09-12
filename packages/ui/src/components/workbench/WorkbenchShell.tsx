import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import {
  workbenchShellCompactClass,
  workbenchShellDefaultClass,
} from './workbench-layout';

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
        local.compact ? workbenchShellCompactClass : workbenchShellDefaultClass,
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
