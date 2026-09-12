import { splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import {
  rewindPanelActionsClass,
  rewindPanelStateClass,
} from './rewind-panel-layout';

export {
  rewindDialogOverlayClass,
  rewindDialogPanelClass,
  rewindPanelActionButtonClass,
  rewindPanelActionsClass,
  rewindPanelBodyClass,
  rewindPanelLoadingSpinnerClass,
  rewindPanelLoadingStateClass,
  rewindPanelStateClass,
} from './rewind-panel-layout';

export type RewindPanelStateProps = {
  class?: string;
  children: JSX.Element;
  role?: JSX.AriaAttributes['role'];
};

/** T3 · Rewind 面板居中状态区（loading / empty / success / error）。 */
export const RewindPanelState: Component<RewindPanelStateProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'role']);

  return (
    <div class={cn(rewindPanelStateClass, local.class)} role={local.role} {...rest}>
      {local.children}
    </div>
  );
};

export type RewindPanelActionsProps = {
  class?: string;
  children: JSX.Element;
};

/** T3 · Rewind 面板底栏操作行（窄屏单列重排）。 */
export const RewindPanelActions: Component<RewindPanelActionsProps> = (props) => {
  const [local] = splitProps(props, ['class', 'children']);

  return (
    <div class={cn(rewindPanelActionsClass, local.class)}>
      {local.children}
    </div>
  );
};
