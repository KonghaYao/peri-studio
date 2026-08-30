import type { JSX } from 'solid-js';
import { cn } from '@/lib/cn';

export function EmptyState(props: { icon?: JSX.Element; title: string; description?: string; action?: JSX.Element; class?: string }) {
  return (
    <div class={cn('flex flex-col items-center justify-center gap-2 py-12 text-center', props.class)}>
      {props.icon && <div class="mb-1 text-content-faint">{props.icon}</div>}
      <div class="text-13 font-medium text-content-primary">{props.title}</div>
      {props.description && <div class="max-w-72 text-12 leading-normal text-content-muted">{props.description}</div>}
      {props.action && <div class="mt-3">{props.action}</div>}
    </div>
  );
}
