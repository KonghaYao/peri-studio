import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import {
  workbenchPanelChromeActionsClass,
  workbenchPanelChromeHeaderClass,
  workbenchPanelChromeTitleClass,
} from '../workbench/workbench-layout';
import {
  rewindDialogIntroClass,
  rewindDialogIntroDescriptionClass,
  rewindDialogIntroTitleClass,
  rewindDialogSectionClass,
  rewindDialogSectionTitleClass,
  rewindDialogShellClass,
  rewindPanelActionsClass,
  rewindPanelBodyClass,
  rewindPanelFooterClass,
  rewindPanelStateClass,
  rewindPanelStateDescriptionClass,
  rewindPanelStateTitleClass,
} from './rewind-panel-layout';

export {
  rewindDialogContentClass,
  rewindDialogOverlayClass,
  rewindDialogPanelClass,
  rewindPanelActionButtonClass,
  rewindPanelActionsClass,
  rewindPanelBodyClass,
  rewindPanelFooterClass,
  rewindPanelLoadingSpinnerClass,
  rewindPanelLoadingStateClass,
  rewindPanelStateClass,
  rewindPanelStateDescriptionClass,
  rewindPanelStateTitleClass,
} from './rewind-panel-layout';

export type RewindDialogShellProps = {
  class?: string;
  bodyClass?: string;
  title: string;
  actions?: JSX.Element;
  footer?: JSX.Element;
  children: JSX.Element;
};

/** T3 · Rewind Dialog 壳：header + 可滚动 body + 可选 footer。 */
export const RewindDialogShell: Component<RewindDialogShellProps> = (props) => {
  const [local] = splitProps(props, ['class', 'bodyClass', 'title', 'actions', 'footer', 'children']);

  return (
    <div class={cn(rewindDialogShellClass, local.class)}>
      <header class={workbenchPanelChromeHeaderClass}>
        <div class={workbenchPanelChromeTitleClass}>{local.title}</div>
        <Show when={local.actions}>
          <div class={workbenchPanelChromeActionsClass}>{local.actions}</div>
        </Show>
      </header>
      <div class={cn(rewindPanelBodyClass, local.bodyClass)}>{local.children}</div>
      <Show when={local.footer}>
        <footer class={rewindPanelFooterClass}>{local.footer}</footer>
      </Show>
    </div>
  );
};

export type RewindDialogIntroProps = {
  class?: string;
  title: string;
  description: string;
};

/** T3 · Rewind 步骤说明（标题 + 描述）。 */
export const RewindDialogIntro: Component<RewindDialogIntroProps> = (props) => {
  const [local] = splitProps(props, ['class', 'title', 'description']);

  return (
    <div class={cn(rewindDialogIntroClass, local.class)}>
      <h2 class={rewindDialogIntroTitleClass}>{local.title}</h2>
      <p class={rewindDialogIntroDescriptionClass}>{local.description}</p>
    </div>
  );
};

export type RewindDialogSectionProps = {
  class?: string;
  title: string;
  headingId?: string;
  children: JSX.Element;
};

/** T3 · Rewind 正文分段（如 file impact）。 */
export const RewindDialogSection: Component<RewindDialogSectionProps> = (props) => {
  const [local] = splitProps(props, ['class', 'title', 'headingId', 'children']);
  const headingId = () => local.headingId ?? 'rewind-dialog-section-heading';

  return (
    <section class={cn(rewindDialogSectionClass, local.class)} aria-labelledby={headingId()}>
      <h3 id={headingId()} class={rewindDialogSectionTitleClass}>{local.title}</h3>
      {local.children}
    </section>
  );
};

export type RewindPanelStateProps = {
  class?: string;
  title?: string;
  description?: string;
  children?: JSX.Element;
  role?: JSX.AriaAttributes['role'];
};

/** T3 · Rewind 面板居中状态区（loading / empty / success / error）。 */
export const RewindPanelState: Component<RewindPanelStateProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'title', 'description', 'children', 'role']);

  return (
    <div class={cn(rewindPanelStateClass, local.class)} role={local.role} {...rest}>
      <Show when={local.title}>
        <p class={rewindPanelStateTitleClass}>{local.title}</p>
      </Show>
      <Show when={local.description}>
        <p class={rewindPanelStateDescriptionClass}>{local.description}</p>
      </Show>
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
