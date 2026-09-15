import {
  createMemo,
  createSignal,
  Show,
  splitProps,
  type Component,
  type JSX,
  type ParentComponent,
} from 'solid-js';
import { cn } from '../lib/cn';
import {
  EnhancedDataTable,
  type EnhancedDataTableColumn,
  type EnhancedDataTableProps,
  type ServerPagination,
} from './DataTableFeatures';
import {
  DataTableToolbarShell,
  type DataTableToolbarColumnMeta,
} from './DataTableToolbarShell';
import { PaginationControls, type PaginationControlsProps } from './Pagination';

const tableViewRootClass =
  'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-8 border border-border-subtle bg-surface';

export type TableViewProps = {
  class?: string;
  children?: JSX.Element;
  'data-testid'?: string;
};

/** T3 · Standard table page shell: toolbar · scroll body · footer pagination. */
export const TableView: Component<TableViewProps> & {
  Toolbar: ParentComponent<{ class?: string }>;
  Body: ParentComponent<{ class?: string }>;
  Footer: ParentComponent<{ class?: string }>;
  ServerTable: <T>(props: TableViewServerTableProps<T>) => JSX.Element;
} = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div
      data-slot="table-view"
      class={cn(tableViewRootClass, local.class)}
      {...rest}
    >
      {local.children}
    </div>
  );
};

TableView.Toolbar = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div
      data-slot="table-view-toolbar"
      class={cn('shrink-0 border-b border-border-subtle py-8', local.class)}
      {...rest}
    >
      {local.children}
    </div>
  );
};

TableView.Body = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div
      data-slot="table-view-body"
      class={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', local.class)}
      {...rest}
    >
      {local.children}
    </div>
  );
};

TableView.Footer = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div
      data-slot="table-view-footer"
      class={cn('shrink-0 border-t border-border-subtle', local.class)}
      {...rest}
    >
      {local.children}
    </div>
  );
};

export type TableViewServerTableProps<T> = Omit<
  EnhancedDataTableProps<T>,
  'toolbar' | 'pagination' | 'embedded' | 'class'
> & {
  class?: string;
  toolbar?: JSX.Element;
  pagination?: ServerPagination;
  paginationControls?: Omit<
    PaginationControlsProps,
    'current' | 'pageSize' | 'total' | 'onChange'
  >;
};

function ServerTableInner<T>(props: TableViewServerTableProps<T>) {
  const [local, tableProps] = splitProps(props, [
    'class',
    'toolbar',
    'pagination',
    'paginationControls',
    'showColumnToggle',
    'columns',
    'columnVisibility',
    'onColumnVisibilityChange',
  ]);

  const [internalColumnVisibility, setInternalColumnVisibility] = createSignal<
    Record<string, boolean>
  >({});

  const columnVisibility = () => local.columnVisibility ?? internalColumnVisibility();

  const toolbarColumns = createMemo((): DataTableToolbarColumnMeta[] => {
    if (!local.showColumnToggle) return [];
    return (local.columns ?? []).map((column) => ({
      id: column.id,
      label: column.header,
      visible: columnVisibility()[column.id] !== false,
      hideable: column.hideable ?? true,
    }));
  });

  const onColumnVisibilityChange = (columnId: string, visible: boolean) => {
    const next = { ...columnVisibility(), [columnId]: visible };
    if (local.columnVisibility === undefined) {
      setInternalColumnVisibility(next);
    }
    local.onColumnVisibilityChange?.(next);
  };

  const showToolbar = () => Boolean(local.showColumnToggle || local.toolbar);

  return (
    <TableView class={local.class}>
      <Show when={showToolbar()}>
        <TableView.Toolbar>
          <DataTableToolbarShell
            columns={toolbarColumns()}
            onColumnVisibilityChange={onColumnVisibilityChange}
            toolbar={local.toolbar}
            data-testid="table-view-toolbar"
          />
        </TableView.Toolbar>
      </Show>
      <TableView.Body>
        <EnhancedDataTable
          {...tableProps}
          columns={local.columns ?? []}
          embedded
          showColumnToggle={false}
          columnVisibility={columnVisibility()}
          onColumnVisibilityChange={(next) => {
            if (local.columnVisibility === undefined) {
              setInternalColumnVisibility(next);
            }
            local.onColumnVisibilityChange?.(next);
          }}
        />
      </TableView.Body>
      <Show when={local.pagination}>
        {(pagination) => (
          <TableView.Footer>
            <PaginationControls
              class="px-8 py-8"
              current={pagination().current}
              pageSize={pagination().pageSize}
              total={pagination().total}
              showTotal
              showSizeChanger
              onChange={(page, pageSize) => pagination().onChange?.(page, pageSize)}
              {...local.paginationControls}
            />
          </TableView.Footer>
        )}
      </Show>
    </TableView>
  );
}

TableView.ServerTable = ServerTableInner;

export type { EnhancedDataTableColumn, ServerPagination };
