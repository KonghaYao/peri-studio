import type { JSX } from 'solid-js';
import { cn } from '@peri/ui';

export function ResourceSectionTitle(props: { children: JSX.Element; compact?: boolean }) {
  return (
    <div
      data-testid="resource-section-title"
      class={cn(
        'resource-section-title flex items-center border-b pointer-coarse:h-44',
        props.compact
          ? 'h-28 border-divider px-8 text-10 font-650 uppercase tracking-6 text-text-secondary'
          : 'h-36 border-border-subtle px-10 text-10 font-semibold uppercase tracking-wide text-content-muted',
      )}
    >
      {props.children}
    </div>
  );
}
