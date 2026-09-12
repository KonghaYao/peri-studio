import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import {
  workbenchPanelChromeActionsClass,
  workbenchPanelChromeBodyClass,
  workbenchPanelChromeClass,
  workbenchPanelChromeHeaderClass,
  workbenchPanelChromeTitleClass,
} from './workbench-layout';

export type WorkbenchPanelChromeProps = {
  class?: string;
  bodyClass?: string;
  title?: JSX.Element;
  actions?: JSX.Element;
  children?: JSX.Element;
};

export {
  workbenchPanelChromeHeaderClass,
  workbenchPanelChromeTitleClass,
} from './workbench-layout';

/** T3 · 浮动 / 内嵌面板头 + 可滚动 body。 */
export const WorkbenchPanelChrome: Component<WorkbenchPanelChromeProps> = (props) => {
  const [local] = splitProps(props, ['class', 'bodyClass', 'title', 'actions', 'children']);

  return (
    <div class={cn(workbenchPanelChromeClass, local.class)}>
      <Show when={local.title || local.actions}>
        <header class={workbenchPanelChromeHeaderClass}>
          <div class={workbenchPanelChromeTitleClass}>{local.title}</div>
          <Show when={local.actions}>
            <div class={workbenchPanelChromeActionsClass}>{local.actions}</div>
          </Show>
        </header>
      </Show>
      <Show when={local.children}>
        <div class={cn(workbenchPanelChromeBodyClass, local.bodyClass)}>{local.children}</div>
      </Show>
    </div>
  );
};
