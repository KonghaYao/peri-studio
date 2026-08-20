// 确认弹窗内容（P4 公共组件）：runtime-dialog 结构的确认对话框主体。
//
// 收敛 ChatHeader（关闭运行实例）与 ProjectSidebar（归档项目 / 归档会话）
// 三处逐行相似的「eyebrow + 标题 + 说明 + 警告 + 取消/危险主按钮」模板。
// Dialog 外层（open/title/dismissible/onClose）仍由调用方管理；本组件
// 只渲染 runtime-dialog 内容，保证三处 DOM 结构一致。

import { Show, type JSX } from 'solid-js';
import { Button } from '../../../components/ui';

export interface ConfirmDialogProps {
  /** 顶部眉标（dialog-eyebrow）；缺省不渲染。 */
  eyebrow?: string;
  /** h2 标题。 */
  title: JSX.Element;
  /** 说明段落（<p> 内容）。 */
  description: JSX.Element;
  /** 警告行（runtime-dialog__warning）；缺省不渲染。 */
  warning?: JSX.Element;
  /** 取消按钮禁用（如正在提交）。 */
  cancelDisabled?: boolean;
  /** 主按钮文案。 */
  confirmLabel: string;
  /** 主按钮禁用（如运行中不可归档）。 */
  confirmDisabled?: boolean;
  /** 主按钮 busy（提交中）。 */
  confirmBusy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <div class="p-20">
      <Show when={props.eyebrow}><span class="block mb-5 text-text-muted text-10 font-bold tracking-8 uppercase">{props.eyebrow}</span></Show>
      <h2 class="m-0 text-19 tracking-[-.02em]">{props.title}</h2>
      <p class="mt-9 mb-0 text-13 leading-155 text-text-secondary">{props.description}</p>
      <Show when={props.warning}><p class="mt-9 mb-0 rounded-9 bg-warning-soft px-10 py-9 !text-warning text-13 leading-155">{props.warning}</p></Show>
      <div class="mt-20 flex justify-end gap-6">
        <Button disabled={props.cancelDisabled} onClick={props.onCancel}>Cancel</Button>
        <Button variant="danger" busy={props.confirmBusy} disabled={props.confirmDisabled} onClick={props.onConfirm}>{props.confirmLabel}</Button>
      </div>
    </div>
  );
}
