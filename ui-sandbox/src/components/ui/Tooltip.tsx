import { Tooltip as KTooltip } from '@kobalte/core/tooltip';
import type { JSX } from 'solid-js';
import { cn } from '@/lib/cn';

/* AntD 风格深色 tooltip */
export function Tooltip(props: { content: string; children: JSX.Element; placement?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <KTooltip placement={props.placement ?? 'top'} openDelay={200}>
      <KTooltip.Trigger as="span" class="inline-flex">{props.children}</KTooltip.Trigger>
      <KTooltip.Portal>
        <KTooltip.Content
          class={cn(
            'z-(--z-tooltip,60) rounded-md bg-neutral-800 px-2 py-1 text-12 leading-snug text-white shadow-overlay',
            'animate-in fade-in duration-(--duration-fast)',
          )}
          style={{ 'background-color': 'var(--palette-neutral-800)' }}
        >
          {props.content}
        </KTooltip.Content>
      </KTooltip.Portal>
    </KTooltip>
  );
}
