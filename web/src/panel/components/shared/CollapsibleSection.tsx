// 可折叠详情面板（P4 公共组件）：details 折叠面板的结构契约。
//
// 收敛 AgentActivityRail / AgentPlanPanel / ToolCallCard 三处手写的
// `details > summary（mark + copy + meta + chevron）+ body` 模板，防止
// 样式镜像漂移。所有类名由调用方传入（feature 视觉保持在 feature CSS
// 中），本组件只保证结构一致。

import type { JSX } from 'solid-js';

export interface CollapsibleSectionProps {
  /** details 根类名（如 agent-activity / agent-plan / tool-card ...）。 */
  detailsClass: string;
  /** summary 额外类名（如 tool-card__summary）。 */
  summaryClass?: string;
  /** details aria-label。 */
  label?: string;
  /** 初始展开（如错误态 tool-card）。 */
  open?: boolean;
  /** summary 内的状态标记（圆点/图标），类名由调用方给出。 */
  mark?: JSX.Element;
  /** summary 主体（标题 + 副文本），类名由调用方给出。 */
  copy: JSX.Element;
  /** summary 尾部的计数/进度/状态。 */
  meta?: JSX.Element;
  /** chevron 类名（旋转动画由 feature CSS 的 `[open]` 规则驱动）。 */
  chevronClass: string;
  /** 展开后的内容。 */
  children: JSX.Element;
}

export function CollapsibleSection(props: CollapsibleSectionProps) {
  return (
    <details class={props.detailsClass} aria-label={props.label} open={props.open}>
      <summary class={props.summaryClass}>
        {props.mark}
        {props.copy}
        {props.meta}
        <span class={props.chevronClass} aria-hidden="true">›</span>
      </summary>
      {props.children}
    </details>
  );
}
