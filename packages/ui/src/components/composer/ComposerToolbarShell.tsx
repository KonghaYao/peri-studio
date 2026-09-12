import type { Component, JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { composerToolbarClass, composerToolbarLeftClass, composerToolbarRightClass } from './composer-layout';

export type ComposerToolbarShellProps = {
  left: JSX.Element;
  right: JSX.Element;
  shortcut?: string;
  class?: string;
};

/** Composer 工具栏布局壳：左右槽位 + 键盘提示。 */
export const ComposerToolbarShell: Component<ComposerToolbarShellProps> = (props) => (
  <div
    data-testid="composer-toolbar"
    class={cn(composerToolbarClass, props.class)}
  >
    <div class={composerToolbarLeftClass}>
      {props.left}
    </div>
    <span class="sr-only" aria-hidden="true">
      {props.shortcut ?? 'Enter to send · Shift + Enter for newline'}
    </span>
    <div class={composerToolbarRightClass}>
      {props.right}
    </div>
  </div>
);
