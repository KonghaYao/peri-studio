import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-solid';
import {
  createContext,
  createMemo,
  For,
  Show,
  splitProps,
  useContext,
  type Accessor,
  type Component,
  type JSX,
  type ParentComponent,
} from 'solid-js';
import { createControllableSignal } from '../lib/controllable-state';
import { cn } from '../lib/cn';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './Table';

export type SortDirection = 'asc' | 'desc';

export type DataTableSortState = {
  columnId: string;
  direction: SortDirection;
} | null;

export type DataTableColumn<T> = {
  id: string;
  header: string;
  accessor?: (row: T) => unknown;
  cell?: (row: T) => JSX.Element;
  sortable?: boolean;
  sortFn?: (a: T, b: T) => number;
  class?: string;
  headerClass?: string;
};

type DataTableContextValue<T> = {
  data: Accessor<T[]>;
  columns: Accessor<DataTableColumn<T>[]>;
  sort: Accessor<DataTableSortState>;
  toggleSort: (columnId: string) => void;
  sortedData: Accessor<T[]>;
  getRowKey: (row: T, index: number) => string;
};

const DataTableContext = createContext<DataTableContextValue<unknown>>();

function useDataTableContext(component: string) {
  const context = useContext(DataTableContext);
  if (!context) {
    throw new Error(`${component} must be used within DataTable`);
  }
  return context;
}

function compareValues(left: unknown, right: unknown) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

function sortRows<T>(
  rows: T[],
  columns: DataTableColumn<T>[],
  sort: DataTableSortState,
) {
  if (!sort) return rows;

  const column = columns.find((item) => item.id === sort.columnId);
  if (!column?.sortable) return rows;

  const compare = column.sortFn
    ?? ((left: T, right: T) => compareValues(column.accessor?.(left), column.accessor?.(right)));

  const sorted = [...rows].sort((left, right) => compare(left, right));
  return sort.direction === 'desc' ? sorted.reverse() : sorted;
}

function nextSortState(current: DataTableSortState, columnId: string): DataTableSortState {
  if (!current || current.columnId !== columnId) {
    return { columnId, direction: 'asc' };
  }
  if (current.direction === 'asc') {
    return { columnId, direction: 'desc' };
  }
  return null;
}

function SortIndicator(props: { direction: SortDirection | null }) {
  return (
    <span class="inline-flex size-16 items-center justify-center text-content-muted" aria-hidden="true">
      <Show when={props.direction === 'asc'} fallback={
        <Show when={props.direction === 'desc'} fallback={<ArrowUpDown size={14} />}>
          <ArrowDown size={14} />
        </Show>
      }>
        <ArrowUp size={14} />
      </Show>
    </span>
  );
}

type DataTableProps<T> = {
  data?: T[];
  columns?: DataTableColumn<T>[];
  sort?: DataTableSortState;
  defaultSort?: DataTableSortState;
  onSortChange?: (sort: DataTableSortState) => void;
  getRowKey?: (row: T, index: number) => string;
  class?: string;
  frameClass?: string;
  children?: JSX.Element;
};

const dataTableFrameClass =
  'overflow-hidden rounded-8 border border-border-subtle bg-surface';

const dataTableTableClass =
  '[&_tbody_tr:last-child]:border-b-0 [&_th:not(:last-child)]:border-r [&_th:not(:last-child)]:border-border-subtle [&_td:not(:last-child)]:border-r [&_td:not(:last-child)]:border-border-subtle';

/** 轻量数据表：复用 Table 原语，支持列定义 props 或 children 组合与客户端排序。 */
export function DataTable<T>(props: DataTableProps<T>) {
  const [local, rest] = splitProps(props, [
    'data',
    'columns',
    'sort',
    'defaultSort',
    'onSortChange',
    'getRowKey',
    'class',
    'frameClass',
    'children',
  ]);

  const data = createMemo(() => local.data ?? []);
  const columns = createMemo(() => local.columns ?? []);
  const [sort, setSort] = createControllableSignal<DataTableSortState>({
    prop: () => local.sort,
    defaultProp: local.defaultSort ?? null,
    onChange: local.onSortChange,
  });

  const sortedData = createMemo(() => sortRows(data(), columns(), sort()));
  const getRowKey = (row: T, index: number) =>
    local.getRowKey?.(row, index) ?? String(index);

  const toggleSort = (columnId: string) => {
    setSort(nextSortState(sort(), columnId));
  };

  const context: DataTableContextValue<T> = {
    data,
    columns,
    sort,
    toggleSort,
    sortedData,
    getRowKey,
  };

  const hasDeclarativeBody = () => columns().length > 0 && local.children == null;

  return (
    <DataTableContext.Provider value={context as DataTableContextValue<unknown>}>
      <div data-slot="data-table" class={cn(dataTableFrameClass, local.frameClass)}>
        <Table class={cn(dataTableTableClass, local.class)} {...rest}>
        <Show
          when={hasDeclarativeBody()}
          fallback={local.children}
        >
          <DataTableHeader>
            <DataTableRow>
              <For each={columns()}>
                {(column) => (
                  <DataTableHead
                    column={column.id}
                    sortable={column.sortable}
                    class={column.headerClass}
                  >
                    {column.header}
                  </DataTableHead>
                )}
              </For>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            <For each={sortedData()}>
              {(row, index) => (
                <DataTableRow data-row-key={getRowKey(row, index())}>
                  <For each={columns()}>
                    {(column) => (
                      <DataTableCell class={column.class}>
                        {column.cell ? column.cell(row) : String(column.accessor?.(row) ?? '')}
                      </DataTableCell>
                    )}
                  </For>
                </DataTableRow>
              )}
            </For>
          </DataTableBody>
        </Show>
        </Table>
      </div>
    </DataTableContext.Provider>
  );
}

export const DataTableHeader: ParentComponent<JSX.HTMLAttributes<HTMLTableSectionElement>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return <TableHeader class={local.class} {...rest}>{local.children}</TableHeader>;
};

export const DataTableBody: ParentComponent<JSX.HTMLAttributes<HTMLTableSectionElement>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return <TableBody class={local.class} {...rest}>{local.children}</TableBody>;
};

export const DataTableRow: ParentComponent<JSX.HTMLAttributes<HTMLTableRowElement>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return <TableRow class={local.class} {...rest}>{local.children}</TableRow>;
};

type DataTableHeadProps = JSX.ThHTMLAttributes<HTMLTableCellElement> & {
  column?: string;
  sortable?: boolean;
};

export const DataTableHead: Component<DataTableHeadProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'column', 'sortable']);
  const context = useDataTableContext('DataTableHead');
  const columnId = () => local.column;
  const sortable = () => {
    if (local.sortable !== undefined) return local.sortable;
    if (!columnId()) return false;
    return context.columns().find((column) => column.id === columnId())?.sortable ?? false;
  };
  const direction = () => {
    const current = context.sort();
    if (!columnId() || !current || current.columnId !== columnId()) return null;
    return current.direction;
  };
  const ariaSort = () => {
    const value = direction();
    if (!sortable() || !value) return 'none' as const;
    return value === 'asc' ? 'ascending' as const : 'descending' as const;
  };

  const content = (
    <span class="inline-flex items-center gap-4">
      <span>{local.children}</span>
      <Show when={sortable()}>
        <SortIndicator direction={direction()} />
      </Show>
    </span>
  );

  return (
    <TableHead
      class={cn(sortable() && 'cursor-pointer select-none', local.class)}
      aria-sort={sortable() ? ariaSort() : undefined}
      data-sortable={sortable() ? '' : undefined}
      {...rest}
    >
      <Show
        when={sortable() && columnId()}
        fallback={content}
      >
        <button
          type="button"
          class="inline-flex w-full items-center gap-4 bg-transparent p-0 text-left font-inherit text-inherit outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring"
          onClick={() => context.toggleSort(columnId()!)}
        >
          {content}
        </button>
      </Show>
    </TableHead>
  );
};

export const DataTableCell: ParentComponent<JSX.TdHTMLAttributes<HTMLTableCellElement>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return <TableCell class={local.class} {...rest}>{local.children}</TableCell>;
};

/** 读取 DataTable 排序后的数据，供 children 组合模式使用。 */
export function useDataTable<T = unknown>() {
  return useDataTableContext('useDataTable') as DataTableContextValue<T>;
}
