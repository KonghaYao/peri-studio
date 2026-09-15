import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { Sheet, SheetClose, SheetContent } from '../Sheet';
import {
  monitorTraceTurnTreeSheetRootClass,
  monitorTraceTurnTreeSheetTreeBodyClass,
} from './monitor-panel-layout';

export type MonitorTraceTurnTreeSheetShellProps = {
  treeTitle?: string;
  treeToolbar?: JSX.Element;
  tree: JSX.Element;
  detail: JSX.Element;
  detailTitle?: JSX.Element;
  /** Open when `selectedId !== undefined` (trace root or observation selected). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  class?: string;
  'data-testid'?: string;
};

/** T3 · trace observation 树 + 右侧 Sheet 详情（自 peri-fuse trace-detail-page）。 */
export const MonitorTraceTurnTreeSheetShell: Component<MonitorTraceTurnTreeSheetShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'treeTitle',
    'treeToolbar',
    'tree',
    'detail',
    'detailTitle',
    'open',
    'onOpenChange',
    'class',
  ]);

  return (
    <>
      <div
        {...rest}
        data-testid={rest['data-testid'] ?? 'monitor-trace-turn-tree-sheet-shell'}
        class={cn(monitorTraceTurnTreeSheetRootClass, local.class)}
      >
        <header class="flex shrink-0 items-center justify-between gap-8 border-b border-border-subtle px-8 py-8">
          <h3 class="text-12 font-600 text-content-primary">
            {local.treeTitle ?? 'Observation tree'}
          </h3>
          <Show when={local.treeToolbar}>{local.treeToolbar}</Show>
        </header>
        <div class={monitorTraceTurnTreeSheetTreeBodyClass} aria-label="Observation tree">
          {local.tree}
        </div>
      </div>

      <Sheet open={local.open} onOpenChange={local.onOpenChange}>
        <SheetContent
          side="right"
          class="w-(--container-settings) gap-0 p-0"
          aria-label="Observation detail"
        >
          <header class="flex shrink-0 items-center gap-8 border-b border-border-subtle px-16 py-12">
            <div class="min-w-0 flex-1 text-14 font-600 text-content-primary">
              <Show when={local.detailTitle} fallback={<span>Observation detail</span>}>
                {local.detailTitle}
              </Show>
            </div>
            <SheetClose aria-label="Close observation detail" />
          </header>
          <div class="ui-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-16 py-12">
            {local.detail}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};
