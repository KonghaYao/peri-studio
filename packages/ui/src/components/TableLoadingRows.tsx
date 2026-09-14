import { For, splitProps, type Component } from 'solid-js';
import { cn } from '../lib/cn';
import { Skeleton } from './Skeleton';
import { Table, TableBody, TableCell, TableRow } from './Table';

export type TableLoadingRowsProps = {
  rows?: number;
  columns?: number;
  class?: string;
  'data-testid'?: string;
};

function createIndices(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}

/** T2 · 表格骨架行（列数/行数可配）。 */
export const TableLoadingRows: Component<TableLoadingRowsProps> = (props) => {
  const [local, rest] = splitProps(props, ['rows', 'columns', 'class']);
  const rowCount = () => local.rows ?? 8;
  const columnCount = () => local.columns ?? 4;

  return (
    <Table
      {...rest}
      aria-busy="true"
      aria-label="Loading table rows"
      class={cn('pointer-events-none', local.class)}
    >
      <TableBody>
        <For each={createIndices(rowCount())}>
          {() => (
            <TableRow>
              <For each={createIndices(columnCount())}>
                {() => (
                  <TableCell>
                    <Skeleton class="h-36 w-full" />
                  </TableCell>
                )}
              </For>
            </TableRow>
          )}
        </For>
      </TableBody>
    </Table>
  );
};
