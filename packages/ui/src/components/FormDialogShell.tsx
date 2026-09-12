// 表单/步骤弹窗内容壳：与 ConfirmDialog 共用 p-20 + 标题视觉契约。
// Dialog 外层（open/dismissible/onOpenChange）仍由调用方管理。

import { Show, type JSX } from 'solid-js';
import { DialogDescription, DialogHeader, DialogTitle } from './Dialog';
import { FieldGroup } from './field-primitive';

export interface FormDialogShellProps {
  /** 顶部眉标；缺省不渲染。 */
  eyebrow?: JSX.Element;
  /** 弹窗标题（DialogTitle / h2）。 */
  title: JSX.Element;
  /** 说明段落；缺省不渲染。 */
  description?: JSX.Element;
  children?: JSX.Element;
}

export function FormDialogShell(props: FormDialogShellProps) {
  return (
    <div class="p-20">
      <DialogHeader class="flex-col items-start gap-9 border-0 px-0 py-0">
        <Show when={props.eyebrow}>
          <span class="text-text-muted text-10 font-bold tracking-8 uppercase">{props.eyebrow}</span>
        </Show>
        <DialogTitle class="m-0 text-19 tracking-(--tracking-dialog)">{props.title}</DialogTitle>
        <Show when={props.description}>
          <DialogDescription class="m-0 text-13 leading-155 text-text-secondary">
            {props.description}
          </DialogDescription>
        </Show>
      </DialogHeader>
      <Show when={props.children}>
        <FieldGroup class="mt-16 gap-12">{props.children}</FieldGroup>
      </Show>
    </div>
  );
}
