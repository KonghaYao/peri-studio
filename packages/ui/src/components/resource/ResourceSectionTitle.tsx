import type { Component, JSX } from 'solid-js';
import { cn } from '../../lib/cn';

/** 资源面板区头；默认密度与 sandbox ExplorerSectionHeader 对齐。 */
export const ResourceSectionTitle: Component<{ children: JSX.Element; compact?: boolean }> = (props) => (
  <div
    data-testid="resource-section-title"
    class={cn(
      'resource-section-title flex items-center',
      props.compact
        ? 'h-28 border-b border-divider px-8 text-10 font-650 uppercase tracking-6 text-text-secondary'
        : 'h-36 gap-4 border-b border-border-subtle px-8 text-11 font-semibold uppercase tracking-wide text-content-muted',
    )}
  >
    {props.children}
  </div>
);
