import { createVirtualizer } from '@tanstack/solid-virtual';
import { For, Show, createEffect, createMemo, splitProps, type Component } from 'solid-js';
import { createStore } from 'solid-js/store';
import { cn } from '../lib/cn';
import { JsonTreeRowView } from './JsonTreeRow';
import {
  DEFAULT_VIRTUALIZE_AFTER,
  buildInitialExpansionPaths,
  flattenVisibleRows,
  type JsonTreeRow,
} from './json-tree-model';

export { DEFAULT_VIRTUALIZE_AFTER } from './json-tree-model';

export type JsonTreeProps = {
  data: unknown;
  /** 初始展开深度；更深节点默认折叠。 */
  defaultCollapsedDepth?: number;
  /** 展开后可见行数超过此值时启用虚拟滚动。 */
  virtualizeAfter?: number;
  class?: string;
  'data-testid'?: string;
};

const ROW_ESTIMATE_SIZE = 28;

type JsonTreeVirtualListProps = {
  rows: () => JsonTreeRow[];
  onToggle: (path: string) => void;
};

const JsonTreeVirtualList: Component<JsonTreeVirtualListProps> = (props) => {
  let scrollRef: HTMLDivElement | undefined;

  const virtualizer = createVirtualizer({
    get count() {
      return props.rows().length;
    },
    getScrollElement: () => scrollRef ?? null,
    estimateSize: () => ROW_ESTIMATE_SIZE,
    overscan: 8,
  });

  return (
    <div
      ref={scrollRef}
      data-json-tree-mode="virtual"
      class="ui-scrollbar max-h-(--container-monitor-io-preview-max) overflow-auto p-8"
    >
      <div
        class="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        <For each={virtualizer.getVirtualItems()}>
          {(virtualRow) => (
            <div
              data-index={virtualRow.index}
              ref={(element) => {
                element.dataset.index = String(virtualRow.index);
                queueMicrotask(() => virtualizer.measureElement(element));
              }}
              class="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <JsonTreeRowView row={props.rows()[virtualRow.index]} onToggle={props.onToggle} />
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

/** T2 · 可折叠 JSON 树；大行数时虚拟滚动，供 Monitor / trace IO 等场景复用。 */
export const JsonTree: Component<JsonTreeProps> = (props) => {
  const [local, rest] = splitProps(props, ['data', 'defaultCollapsedDepth', 'virtualizeAfter', 'class']);
  const collapsedDepth = () => local.defaultCollapsedDepth ?? 2;
  const virtualizeAfter = () => local.virtualizeAfter ?? DEFAULT_VIRTUALIZE_AFTER;

  const empty = () => local.data === null || local.data === undefined;

  const primitive = () => {
    const value = local.data;
    return value !== null && value !== undefined && typeof value !== 'object';
  };

  const [expanded, setExpanded] = createStore<Record<string, boolean>>({});

  createEffect(() => {
    if (empty() || primitive()) return;
    setExpanded(buildInitialExpansionPaths(local.data, collapsedDepth()));
  });

  const visibleRows = createMemo(() => {
    if (empty() || primitive()) return [];
    return flattenVisibleRows(local.data, expanded);
  });

  const shouldVirtualize = createMemo(
    () => visibleRows().length > virtualizeAfter(),
  );

  const togglePath = (path: string) => {
    setExpanded(path, (value) => !value);
  };

  return (
    <div
      {...rest}
      class={cn(
        'ui-json-tree rounded-4 border border-border-subtle bg-surface-sunken text-content-primary wrap-anywhere',
        shouldVirtualize()
          ? 'overflow-hidden p-0'
          : 'ui-scrollbar max-h-(--container-monitor-io-preview-max) overflow-auto p-8',
        local.class,
      )}
    >
      <Show
        when={!empty()}
        fallback={(
          <p class="p-8 text-11 text-content-muted">(empty)</p>
        )}
      >
        <Show
          when={!primitive()}
          fallback={(
            <pre class="whitespace-pre-wrap break-words p-8 font-mono text-11">{String(local.data)}</pre>
          )}
        >
          <Show
            when={shouldVirtualize()}
            fallback={(
              <div data-json-tree-mode="flat">
                <For each={visibleRows()}>
                  {(row) => (
                    <JsonTreeRowView row={row} onToggle={togglePath} />
                  )}
                </For>
              </div>
            )}
          >
            <JsonTreeVirtualList rows={visibleRows} onToggle={togglePath} />
          </Show>
        </Show>
      </Show>
    </div>
  );
};
