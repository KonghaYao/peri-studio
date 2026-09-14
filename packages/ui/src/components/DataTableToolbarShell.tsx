import { Settings2 } from 'lucide-solid';
import { For, Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { Button } from './Button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

/** 列可见性元数据；不含 tanstack 类型。 */
export type DataTableToolbarColumnMeta = {
  id: string;
  label: string;
  visible: boolean;
  /** 默认 true；false 时不出现在 Toggle 菜单。 */
  hideable?: boolean;
};

export type DataTableToolbarShellProps = {
  /** 可切换列及其可见性（受控）。 */
  columns: DataTableToolbarColumnMeta[];
  onColumnVisibilityChange?: (columnId: string, visible: boolean) => void;
  /** 左侧工具区（筛选、刷新等）。 */
  toolbar?: JSX.Element;
  columnsButtonLabel?: string;
  toggleColumnsLabel?: string;
  class?: string;
  'data-testid'?: string;
};

/**
 * T3 · DataTable 顶栏壳：toolbar slot + Columns 可见性下拉。
 * 对应 peri-fuse `data-table.tsx` toolbar 区；列状态由 T4 注入。
 */
export const DataTableToolbarShell: Component<DataTableToolbarShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'columns',
    'onColumnVisibilityChange',
    'toolbar',
    'columnsButtonLabel',
    'toggleColumnsLabel',
    'class',
  ]);

  const hideableColumns = () =>
    local.columns.filter((column) => column.hideable !== false);

  return (
    <div
      {...rest}
      class={cn('flex items-center gap-8 px-8', local.class)}
      data-slot="data-table-toolbar"
    >
      {local.toolbar}
      <Show when={hideableColumns().length > 0}>
        <DropdownMenu placement="bottom-end">
          <DropdownMenuTrigger
            as={Button}
            variant="default"
            size="sm"
            class="ml-auto h-28 shrink-0"
            aria-label={local.columnsButtonLabel ?? 'Columns'}
          >
            <Settings2 size={14} aria-hidden="true" />
            {local.columnsButtonLabel ?? 'Columns'}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            class="max-h-320 w-(--container-menu-min) overflow-auto"
            aria-label={local.toggleColumnsLabel ?? 'Toggle columns'}
          >
            <DropdownMenuLabel>{local.toggleColumnsLabel ?? 'Toggle columns'}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <For each={hideableColumns()}>
              {(column) => (
                <DropdownMenuCheckboxItem
                  class="text-12"
                  checked={column.visible}
                  onChange={(visible) => local.onColumnVisibilityChange?.(column.id, visible)}
                >
                  {column.label}
                </DropdownMenuCheckboxItem>
              )}
            </For>
          </DropdownMenuContent>
        </DropdownMenu>
      </Show>
    </div>
  );
};
