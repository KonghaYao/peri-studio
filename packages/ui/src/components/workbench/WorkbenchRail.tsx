import { splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { workbenchRailClass } from './workbench-layout';

export type WorkbenchRailProps = {
  class?: string;
  'aria-label'?: string;
  children: JSX.Element;
};

/** T3 · Workbench 竖轨容器；T4 注入 `WorkbenchRailButton` 或其它轨钮。 */
export const WorkbenchRail: Component<WorkbenchRailProps> = (props) => {
  const [local] = splitProps(props, ['class', 'aria-label', 'children']);

  return (
    <nav
      class={cn(workbenchRailClass, local.class)}
      aria-label={local['aria-label'] ?? 'Resource views'}
    >
      {local.children}
    </nav>
  );
};
