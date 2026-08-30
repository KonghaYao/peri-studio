import { cn } from '@/lib/cn';
import type { BadgeTone } from './Badge';

/* 状态点 + 文案；live 时呼吸脉冲（base.css 已尊重 reduced-motion）。 */
export function Status(props: { tone?: BadgeTone; label: string; live?: boolean; class?: string }) {
  const tone = () => props.tone ?? 'neutral';
  const dot: Record<BadgeTone, string> = {
    neutral: 'bg-content-faint',
    success: 'bg-success-solid',
    warning: 'bg-warning-solid',
    danger: 'bg-danger-solid',
    info: 'bg-info-solid',
  };
  return (
    <span class={cn('inline-flex items-center gap-1.5 text-12 text-content-secondary', props.class)} aria-live={props.live ? 'polite' : undefined}>
      <span class="relative flex size-2">
        {props.live && <span class={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', dot[tone()])} />}
        <span class={cn('relative inline-flex size-2 rounded-full', dot[tone()])} />
      </span>
      {props.label}
    </span>
  );
}
