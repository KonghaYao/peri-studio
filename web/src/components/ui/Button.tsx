import { createUniqueId, Show, splitProps, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip';

const buttonVariantClasses = {
  // `cn` 使用 tailwind-merge；自定义 text-surface 会被误判成 font-size，
  // 当调用方追加 text-12 时遭删除。显式重要 color 属性把前景色留在 interface。
  primary: 'bg-btn-primary [color:var(--surface)]! hover:bg-btn-primary-hover',
  secondary: 'border-border-strong bg-surface text-text-secondary hover:border-text-primary hover:bg-surface hover:text-text-primary',
  ghost: 'hover:bg-hover',
  danger: 'text-danger hover:bg-hover',
} as const;

const buttonSizeClasses = {
  compact: 'min-h-32 px-9 [font-size:var(--text-12)]',
  default: '',
} as const;

// 不在 base 设置 text-*：Tailwind 的 utility 排序与 class 字符串顺序无关，
// base 的 text-inherit 会覆盖 primary 的前景色，形成深色字叠深色按钮。
// 未声明文字色的 ghost 按钮天然继承父级，其他 variant 各自拥有明确颜色。
const buttonBaseClasses = 'inline-flex min-h-36 items-center justify-center gap-8 rounded-8 border border-transparent bg-transparent px-12 [font-size:var(--text-13)] font-500 cursor-pointer [transition:background_120ms_ease,border-color_120ms_ease,color_120ms_ease,transform_120ms_ease,opacity_120ms_ease] hover:bg-hover active:not-disabled:translate-y-1 disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-44';

type Props = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariantClasses;
  size?: keyof typeof buttonSizeClasses;
  busy?: boolean;
};

export function Button(props: Props) {
  const [local, button] = splitProps(props, ['variant', 'size', 'busy', 'class', 'children', 'disabled']);
  const variant = () => local.variant ?? 'ghost';
  const size = () => local.size ?? 'default';
  return (
    <button
      {...button}
      type={button.type ?? 'button'}
      disabled={local.disabled || local.busy}
      aria-busy={local.busy || undefined}
      data-slot="button"
      class={cn(buttonBaseClasses, buttonVariantClasses[variant()], buttonSizeClasses[size()], local.class)}
    >
      <Show when={local.busy}><span class="ui-spinner" aria-hidden="true" /><span class="sr-only">Processing</span></Show>
      {local.children}
    </button>
  );
}

export function IconButton(props: Props & { label: string; tooltipPlacement?: 'start' | 'center' | 'end' }) {
  const [local, button] = splitProps(props, ['label', 'title', 'class', 'tooltipPlacement']);
  const helpId = `icon-help-${createUniqueId()}`;
  const customHelp = () => !!local.title && local.title !== local.label;
  return <Tooltip placement={local.tooltipPlacement === 'start' ? 'bottom-start' : local.tooltipPlacement === 'end' ? 'bottom-end' : 'bottom'}>
    <TooltipTrigger as="span" class="ui-tooltip-anchor">
      <Button {...button} aria-label={local.label} aria-description={customHelp() ? local.title : undefined} aria-describedby={customHelp() ? helpId : undefined} class={cn('w-34 min-h-34 p-0 pointer-coarse:w-44 pointer-coarse:min-h-44', local.class)} />
    </TooltipTrigger>
    <TooltipContent id={customHelp() ? helpId : undefined}>{local.title ?? local.label}</TooltipContent>
  </Tooltip>;
}
