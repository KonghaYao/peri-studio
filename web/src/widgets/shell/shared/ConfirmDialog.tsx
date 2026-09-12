// 确认弹窗（P1）：@peri/ui AlertDialog 复合组件 + 业务 props 薄封装。
//
// 收敛 ChatHeader（关闭运行实例）与 ProjectSidebar（归档项目 / 归档会话）
// 等处逐行相似的「眉标 + 标题 + 说明 + 警告 + 取消/危险主按钮」模板。

import { Show, type JSX } from 'solid-js';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  InlineNotice,
} from '@peri/ui';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 顶部眉标；缺省不渲染。 */
  eyebrow?: string;
  /** 标题。 */
  title: JSX.Element;
  /** 说明段落。 */
  description: JSX.Element;
  /** 警告行；缺省不渲染。 */
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
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <Show when={props.eyebrow}>
            <span class="text-text-muted text-10 font-bold tracking-8 uppercase">{props.eyebrow}</span>
          </Show>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <Show when={props.warning}>
          <InlineNotice tone="warning">{props.warning}</InlineNotice>
        </Show>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.cancelDisabled} onClick={props.onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="danger"
            disabled={props.confirmDisabled}
            busy={props.confirmBusy}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
