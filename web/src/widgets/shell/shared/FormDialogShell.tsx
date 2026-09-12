// 表单/步骤弹窗内容壳：与 ConfirmDialog 共用 p-20 + 标题视觉契约。
// Dialog 外层（open/dismissible/onOpenChange）仍由调用方管理。

import { Show, type JSX } from 'solid-js';
import { DialogTitle } from '@peri/ui';

export interface FormDialogShellProps {
  /** 弹窗标题（DialogTitle / h2）。 */
  title: JSX.Element;
  /** 说明段落；缺省不渲染。 */
  description?: JSX.Element;
  children?: JSX.Element;
}

export function FormDialogShell(props: FormDialogShellProps) {
  return (
    <div class="p-20">
      <DialogTitle class="m-0 text-19 tracking-(--tracking-dialog)">{props.title}</DialogTitle>
      <Show when={props.description}>
        <p class="mt-9 mb-0 text-13 leading-155 text-text-secondary">{props.description}</p>
      </Show>
      <Show when={props.children}>
        <div class="mt-16">{props.children}</div>
      </Show>
    </div>
  );
}
