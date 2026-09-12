import { ChevronDown, ChevronRight } from 'lucide-solid';
import {
  createMemo,
  createSignal,
  For,
  Show,
  splitProps,
  type Accessor,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import { Checkbox, CheckboxControl, CheckboxInput } from './Checkbox';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  type DataTableColumn,
  type DataTableSortState,
} from './DataTable';
import { Input } from './Field';
import { IconButton } from './Button';
import { PaginationControls } from './Pagination';

export type DataTableSize = 'sm' | 'md' | 'lg';

const sizeClasses: Record<DataTableSize, string> = {
  sm: 'text-12 [&_th]:py-6 [&_td]:py-6',
  md: 'text-13 [&_th]:py-8 [&_td]:py-8',
  lg: 'text-14 [&_th]:py-10 [&_td]:py-10',
};

export type ServerPagination = {
  current: number;
  pageSize: number;
  total: number;
  onChange?: (page: number, pageSize: number) => void;
};

export type EnhancedDataTableProps<T> = {
  data: T[];
  columns: DataTableColumn<T>[];
  rowKey?: (row: T, index: number) => string;
  rowSelection?: {
    selectedKeys?: string[];
    onChange?: (keys: string[]) => void;
  };
  columnFilters?: Record<string, string>;
  onColumnFiltersChange?: (filters: Record<string, string>) => void;
  expandable?: {
    expandedRowRender: (row: T) => JSX.Element;
    rowExpandable?: (row: T) => boolean;
  };
  bordered?: boolean;
  striped?: boolean;
  size?: DataTableSize;
  virtualScroll?: boolean;
  /** 服务端排序：仅触发 onSortChange，不在本地重排 data。 */
  serverSort?: boolean;
  sort?: DataTableSortState;
  onSortChange?: (sort: DataTableSortState) => void;
  pagination?: ServerPagination;
  fixedHeader?: boolean;
  fixedColumnStart?: number;
  class?: string;
};

function stickyColumnClass(index: number, fixedStart: number, isHeader = false) {
  if (index >= fixedStart) return '';
  const left = index === 0 ? 'left-0' : index === 1 ? 'left-80' : 'left-160';
  return cn(
    'sticky z-10 bg-surface',
    left,
    isHeader && 'z-20 bg-surface-sunken',
  );
}

/** DataTable 增强：行选择、列筛选、可展开行、服务端分页/排序、固定头列。 */
export function EnhancedDataTable<T>(props: EnhancedDataTableProps<T>) {
  const [local] = splitProps(props, [
    'data',
    'columns',
    'rowKey',
    'rowSelection',
    'columnFilters',
    'onColumnFiltersChange',
    'expandable',
    'bordered',
    'striped',
    'size',
    'virtualScroll',
    'serverSort',
    'sort',
    'onSortChange',
    'pagination',
    'fixedHeader',
    'fixedColumnStart',
    'class',
  ]);
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [filters, setFilters] = createSignal<Record<string, string>>(local.columnFilters ?? {});
  const [selected, setSelected] = createSignal<string[]>(local.rowSelection?.selectedKeys ?? []);
  const [internalSort, setInternalSort] = createSignal<DataTableSortState>(local.sort ?? null);

  const sortState = () => local.sort ?? internalSort();
  const fixedStart = () => local.fixedColumnStart ?? 0;

  const getKey = (row: T, index: number) => local.rowKey?.(row, index) ?? String(index);

  const filteredData = createMemo(() => {
    if (local.serverSort) return local.data;
    const active = filters();
    return local.data.filter((row) =>
      local.columns.every((column) => {
        const query = active[column.id]?.trim().toLowerCase();
        if (!query) return true;
        const value = String(column.accessor?.(row) ?? '').toLowerCase();
        return value.includes(query);
      }),
    );
  });

  const visibleData: Accessor<T[]> = () => {
    const rows = filteredData();
    if (!local.virtualScroll) return rows;
    return rows.slice(0, 50);
  };

  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelected = (key: string) => {
    const next = selected().includes(key)
      ? selected().filter((item) => item !== key)
      : [...selected(), key];
    setSelected(next);
    local.rowSelection?.onChange?.(next);
  };

  const toggleAll = () => {
    const keys = visibleData().map((row, index) => getKey(row, index));
    const next = selected().length === keys.length ? [] : keys;
    setSelected(next);
    local.rowSelection?.onChange?.(next);
  };

  const onFilterChange = (columnId: string, value: string) => {
    const next = { ...filters(), [columnId]: value };
    setFilters(next);
    local.onColumnFiltersChange?.(next);
  };

  const onSort = (sort: DataTableSortState) => {
    setInternalSort(sort);
    local.onSortChange?.(sort);
  };

  const selectionOffset = () => (local.rowSelection ? 1 : 0) + (local.expandable ? 1 : 0);

  return (
    <div class="flex flex-col gap-12">
      <DataTable
        data={visibleData()}
        columns={local.columns}
        getRowKey={getKey}
        sort={local.serverSort ? sortState() : undefined}
        onSortChange={local.serverSort ? onSort : undefined}
        class={cn(
          sizeClasses[local.size ?? 'md'],
          local.striped && '[&_tbody_tr:nth-child(even)]:bg-surface-sunken',
          local.bordered && '[&_th]:border [&_td]:border [&_th]:border-border-subtle [&_td]:border-border-subtle',
          local.class,
        )}
        frameClass={cn(
          local.virtualScroll || local.fixedHeader ? 'max-h-320 overflow-auto' : undefined,
          local.fixedHeader && '[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20',
        )}
      >
        <DataTableHeader>
          <DataTableRow>
            <Show when={local.rowSelection}>
              <DataTableHead class={cn('w-40', stickyColumnClass(0, fixedStart(), true))}>
                <Checkbox
                  checked={selected().length > 0 && selected().length === visibleData().length}
                  onChange={toggleAll}
                >
                  <CheckboxInput />
                  <CheckboxControl />
                </Checkbox>
              </DataTableHead>
            </Show>
            <Show when={local.expandable}>
              <DataTableHead class="w-40" />
            </Show>
            <For each={local.columns}>
              {(column, index) => (
                <DataTableHead
                  column={column.id}
                  sortable={column.sortable}
                  class={cn(column.headerClass, stickyColumnClass(index() + selectionOffset(), fixedStart(), true))}
                >
                  <div class="flex flex-col gap-6">
                    <span>{column.header}</span>
                    <Show when={!local.serverSort}>
                      <Input
                        placeholder="Filter"
                        class="h-28 text-12"
                        value={filters()[column.id] ?? ''}
                        onInput={(event) => onFilterChange(column.id, event.currentTarget.value)}
                      />
                    </Show>
                  </div>
                </DataTableHead>
              )}
            </For>
          </DataTableRow>
        </DataTableHeader>
        <DataTableBody>
          <For each={visibleData()}>
            {(row, index) => {
              const key = getKey(row, index());
              const canExpand = local.expandable?.rowExpandable?.(row) ?? true;
              return (
                <>
                  <DataTableRow data-row-key={key}>
                    <Show when={local.rowSelection}>
                      <DataTableCell class={stickyColumnClass(0, fixedStart())}>
                        <Checkbox checked={selected().includes(key)} onChange={() => toggleSelected(key)}>
                          <CheckboxInput />
                          <CheckboxControl />
                        </Checkbox>
                      </DataTableCell>
                    </Show>
                    <Show when={local.expandable}>
                      <DataTableCell>
                        <Show when={canExpand}>
                          <IconButton
                            label={expanded().has(key) ? 'Collapse row' : 'Expand row'}
                            size="sm"
                            showTooltip={false}
                            onClick={() => toggleExpanded(key)}
                          >
                            {expanded().has(key) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </IconButton>
                        </Show>
                      </DataTableCell>
                    </Show>
                    <For each={local.columns}>
                      {(column, columnIndex) => (
                        <DataTableCell
                          class={cn(
                            column.class,
                            stickyColumnClass(columnIndex() + selectionOffset(), fixedStart()),
                          )}
                        >
                          {column.cell ? column.cell(row) : String(column.accessor?.(row) ?? '')}
                        </DataTableCell>
                      )}
                    </For>
                  </DataTableRow>
                  <Show when={local.expandable && expanded().has(key)}>
                    <DataTableRow>
                      <DataTableCell colSpan={local.columns.length + selectionOffset()}>
                        {local.expandable?.expandedRowRender(row)}
                      </DataTableCell>
                    </DataTableRow>
                  </Show>
                </>
              );
            }}
          </For>
        </DataTableBody>
      </DataTable>
      <Show when={local.pagination}>
        {(pagination) => (
          <PaginationControls
            current={pagination().current}
            pageSize={pagination().pageSize}
            total={pagination().total}
            showTotal
            showSizeChanger
            onChange={(page, pageSize) => pagination().onChange?.(page, pageSize)}
          />
        )}
      </Show>
    </div>
  );
}
