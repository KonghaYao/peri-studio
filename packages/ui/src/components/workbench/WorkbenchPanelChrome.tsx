import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

export type WorkbenchPanelChromeProps = {
  class?: string;
  bodyClass?: string;
  title?: JSX.Element;
  actions?: JSX.Element;
  children?: JSX.Element;
};

export const workbenchPanelChromeHeaderClass = 'ui-workbench-panel-chrome__header';
export const workbenchPanelChromeTitleClass = 'ui-workbench-panel-chrome__title';

/** T3 · 浮动 / 内嵌面板头 + 可滚动 body。 */
export const WorkbenchPanelChrome: Component<WorkbenchPanelChromeProps> = (props) => {
  const [local] = splitProps(props, ['class', 'bodyClass', 'title', 'actions', 'children']);

  return (
    <div class={cn('ui-workbench-panel-chrome', local.class)}>
      <Show when={local.title || local.actions}>
        <header class={workbenchPanelChromeHeaderClass}>
          <div class={workbenchPanelChromeTitleClass}>{local.title}</div>
          <Show when={local.actions}>
            <div class="ui-workbench-panel-chrome__actions">{local.actions}</div>
          </Show>
        </header>
      </Show>
      <Show when={local.children}>
        <div class={cn('ui-workbench-panel-chrome__body', local.bodyClass)}>{local.children}</div>
      </Show>
    </div>
  );
};
