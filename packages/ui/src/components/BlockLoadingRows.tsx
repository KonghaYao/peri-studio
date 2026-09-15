import { For, splitProps, type Component } from 'solid-js';
import { cn } from '../lib/cn';
import { Skeleton } from './Skeleton';

export type BlockLoadingRowsProps = {
  rows?: number;
  rowClass?: string;
  class?: string;
  'data-testid'?: string;
};

function createIndices(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}

/** T2 · Vertical skeleton stack for card/panel loading (non-table). */
export const BlockLoadingRows: Component<BlockLoadingRowsProps> = (props) => {
  const [local, rest] = splitProps(props, ['rows', 'rowClass', 'class']);
  const rowCount = () => local.rows ?? 4;

  return (
    <div
      {...rest}
      role="status"
      aria-live="polite"
      aria-label="Loading content"
      class={cn('flex flex-col gap-8', local.class)}
    >
      <For each={createIndices(rowCount())}>
        {() => <Skeleton class={cn('h-36 w-full', local.rowClass)} />}
      </For>
    </div>
  );
};
