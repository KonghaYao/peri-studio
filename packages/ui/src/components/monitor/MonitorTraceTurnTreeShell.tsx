import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import {
  monitorTraceTurnTreeShellDetailClass,
  monitorTraceTurnTreeShellRootClass,
  monitorTraceTurnTreeShellTreeClass,
} from './monitor-panel-layout';

export type MonitorTraceTurnTreeShellProps = {
  treeTitle?: string;
  treeToolbar?: JSX.Element;
  tree: JSX.Element;
  detail: JSX.Element;
  detailPlaceholder?: JSX.Element;
  showDetailPlaceholder?: boolean;
  class?: string;
  'data-testid'?: string;
};

/** T3 · trace detail 左右分栏壳（tree | detail），自 peri-fuse trace-detail-page body。 */
export const MonitorTraceTurnTreeShell: Component<MonitorTraceTurnTreeShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'treeTitle',
    'treeToolbar',
    'tree',
    'detail',
    'detailPlaceholder',
    'showDetailPlaceholder',
    'class',
  ]);

  return (
    <div
      {...rest}
      data-testid={rest['data-testid'] ?? 'monitor-trace-turn-tree-shell'}
      class={cn(monitorTraceTurnTreeShellRootClass, local.class)}
    >
      <section class={monitorTraceTurnTreeShellTreeClass} aria-label="Observation tree">
        <header class="flex shrink-0 items-center justify-between gap-8 border-b border-border-subtle px-8 py-8">
          <h3 class="text-12 font-600 text-content-primary">
            {local.treeTitle ?? 'Observation tree'}
          </h3>
          <Show when={local.treeToolbar}>{local.treeToolbar}</Show>
        </header>
        <div class="flex min-h-0 flex-1 flex-col">{local.tree}</div>
      </section>

      <section class={monitorTraceTurnTreeShellDetailClass} aria-label="Observation detail">
        <div class="ui-scrollbar flex min-h-0 flex-1 flex-col overflow-auto">
          <Show
            when={!local.showDetailPlaceholder}
            fallback={(
              <div class="flex min-h-0 flex-1 items-center justify-center px-16 py-24 text-center text-12 text-content-muted">
                {local.detailPlaceholder ?? 'Select the trace root or an observation to view details.'}
              </div>
            )}
          >
            <div class="min-h-0 flex-1 px-16 py-12">
              {local.detail}
            </div>
          </Show>
        </div>
      </section>
    </div>
  );
};
