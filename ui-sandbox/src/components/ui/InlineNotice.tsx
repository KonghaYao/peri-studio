import { AlertCircle, CheckCircle, Info, XCircle } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@/lib/cn';

/* 通知条：白底 + 色边 + 色图标，不用 soft 底。 */
export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const toneClasses: Record<NoticeTone, { box: string; icon: string }> = {
  info: { box: 'border-info-border', icon: 'text-info-solid' },
  success: { box: 'border-success-border', icon: 'text-success-solid' },
  warning: { box: 'border-warning-border', icon: 'text-warning-solid' },
  danger: { box: 'border-danger-border', icon: 'text-danger-solid' },
};

const icons: Record<NoticeTone, typeof Info> = {
  info: Info,
  success: CheckCircle,
  warning: AlertCircle,
  danger: XCircle,
};

export function InlineNotice(props: { tone?: NoticeTone; title?: string; children: JSX.Element; class?: string }) {
  const tone = () => props.tone ?? 'info';
  return (
    <div role={tone() === 'danger' ? 'alert' : 'status'} class={cn('flex gap-2.5 rounded-lg border px-3 py-2.5', toneClasses[tone()].box, props.class)}>
      <span class={cn('mt-px flex-none', toneClasses[tone()].icon)}><Dynamic component={icons[tone()]} size={15} strokeWidth={2} /></span>
      <div class="min-w-0 text-13 leading-normal text-content-primary">
        {props.title && <div class="mb-0.5 font-medium">{props.title}</div>}
        <div class="text-content-secondary">{props.children}</div>
      </div>
    </div>
  );
}
