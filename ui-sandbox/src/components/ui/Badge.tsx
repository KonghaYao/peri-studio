import { splitProps, type JSX } from 'solid-js';
import { cn } from '@/lib/cn';

/* Badge 规则（2026-08-30 定稿）：文字永远是中性灰，颜色由状态点承载。 */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const dotClasses: Record<BadgeTone, string> = {
  neutral: 'bg-content-faint',
  success: 'bg-success-solid',
  warning: 'bg-warning-solid',
  danger: 'bg-danger-solid',
  info: 'bg-info-solid',
};

export function Badge(props: { children: JSX.Element; tone?: BadgeTone; class?: string }) {
  const [local] = splitProps(props, ['children', 'tone', 'class']);
  return (
    <span
      data-slot="badge"
      class={cn(
        'inline-flex h-5 items-center gap-1.5 rounded-full border border-border-strong bg-surface-overlay px-2',
        'text-11 font-medium text-content-secondary',
        local.class,
      )}
    >
      <span class={cn('size-1.5 flex-none rounded-full', dotClasses[local.tone ?? 'neutral'])} aria-hidden="true" />
      {local.children}
    </span>
  );
}
