// 归档区块（P4 公共组件）：sidebar 中「已归档」折叠区块的结构契约。
//
// 收敛 ProjectSidebar 内 archived-projects 与 archived-sessions 双胞胎：
// toggle 按钮（chevron + 文案 + 计数）+ 展开后的列表容器。类名由调用方
// 传入（feature CSS 保持），本组件只保证结构一致。

import { Show, type JSX } from 'solid-js';
import { Icon } from '../../../ui';

export interface ArchivedSectionProps {
  /** toggle 按钮类名（archived-projects__toggle / archived-sessions__toggle）。 */
  toggleClass: string;
  /** 按钮文案（已归档 / 已归档会话）。 */
  label: string;
  /** 计数徽标。 */
  count: number;
  open: boolean;
  onToggle: () => void;
  /** 列表容器 id（aria-controls 与展开态挂载）。 */
  listId: string;
  /** 列表容器类名。 */
  listClass: string;
  /** 展开后的行内容。 */
  children: JSX.Element;
}

export function ArchivedSection(props: ArchivedSectionProps) {
  return (
    <>
      <button
        type="button"
        class={props.toggleClass}
        aria-expanded={props.open}
        aria-controls={props.listId}
        onClick={props.onToggle}
      >
        <Icon size="small"><path d="m7 5 5 5-5 5" /></Icon>
        <span>{props.label}</span>
        <small>{props.count}</small>
      </button>
      <Show when={props.open}><div id={props.listId} class={props.listClass}>{props.children}</div></Show>
    </>
  );
}
