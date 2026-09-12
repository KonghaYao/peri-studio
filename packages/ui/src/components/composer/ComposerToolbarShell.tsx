import type { Component, JSX } from 'solid-js';
import { cn } from '../../lib/cn';

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
    class={cn('ui-composer-toolbar flex min-h-36 min-w-0 items-center gap-4', props.class)}
  >
    <div class="ui-composer-toolbar__left flex min-w-0 shrink items-center gap-4 max-narrow:gap-2">
      {props.left}
    </div>
    <span class="ui-composer-shortcut sr-only" aria-hidden="true">
      {props.shortcut ?? 'Enter to send · Shift + Enter for newline'}
    </span>
    <div class="ui-composer-toolbar__right ml-auto flex min-w-0 items-center justify-end gap-4">
      {props.right}
    </div>
  </div>
);
