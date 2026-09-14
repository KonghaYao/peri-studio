import { createMemo, createSignal, For, Show } from 'solid-js';
import {
  AutoRefreshIntervalControl,
  DataTableToolbarShell,
  FilterInput,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type DataTableToolbarColumnMeta,
} from '@peri/ui';

const REFRESH_OPTIONS = [0, 15_000, 30_000, 60_000] as const;

const ALL_COLUMNS: DataTableToolbarColumnMeta[] = [
  { id: 'traceId', label: 'Trace ID', visible: true },
  { id: 'name', label: 'Name', visible: true },
  { id: 'latency', label: 'Latency', visible: true },
  { id: 'tokens', label: 'Tokens', visible: false },
];

const ROWS = [
  { traceId: 'trace_01HXYZ', name: 'Checkout summary', latency: '842 ms', tokens: '1.2k' },
  { traceId: 'trace_01ABCD', name: 'Sidebar resize', latency: '126 ms', tokens: '420' },
] as const;

/** T4 · DataTable toolbar + auto-refresh + 列可见性（peri-fuse data-table toolbar 抽象）。 */
export function DataTableToolbarLayout() {
  const [query, setQuery] = createSignal<string | undefined>();
  const [refreshMs, setRefreshMs] = createSignal(0);
  const [columns, setColumns] = createSignal<DataTableToolbarColumnMeta[]>(ALL_COLUMNS);

  const visibleColumns = createMemo(() => columns().filter((column) => column.visible));

  const onColumnVisibilityChange = (columnId: string, visible: boolean) => {
    setColumns((current) =>
      current.map((column) => (column.id === columnId ? { ...column, visible } : column)),
    );
  };

  const cellValue = (row: (typeof ROWS)[number], columnId: string) => {
    switch (columnId) {
      case 'traceId':
        return row.traceId;
      case 'name':
        return row.name;
      case 'latency':
        return row.latency;
      case 'tokens':
        return row.tokens;
      default:
        return '';
    }
  };

  return (
    <div class="overflow-hidden rounded-8 border border-border-subtle bg-surface">
      <div class="border-b border-border-subtle px-16 py-12">
        <h2 class="text-14 font-semibold text-content-primary">Data table toolbar</h2>
        <p class="mt-4 text-12 text-content-muted">
          Toolbar slot, column visibility, and auto-refresh cadence — state injected by T4.
        </p>
      </div>

      <DataTableToolbarShell
        class="py-8"
        columns={columns()}
        onColumnVisibilityChange={onColumnVisibilityChange}
        toolbar={
          <>
            <FilterInput
              value={query()}
              onCommit={setQuery}
              placeholder="Trace name or ID"
              title="Search traces"
              class="w-(--container-menu-min)"
            />
            <AutoRefreshIntervalControl
              value={refreshMs()}
              options={[...REFRESH_OPTIONS]}
              onChange={setRefreshMs}
            />
          </>
        }
      />

      <div class="border-t border-border-subtle">
        <Table class="w-full text-12">
          <TableHeader>
            <TableRow class="bg-surface-sunken hover:bg-surface-sunken">
              <For each={visibleColumns()}>
                {(column) => <TableHead class="whitespace-nowrap">{column.label}</TableHead>}
              </For>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={ROWS}>
              {(row) => (
                <TableRow>
                  <For each={visibleColumns()}>
                    {(column) => <TableCell>{cellValue(row, column.id)}</TableCell>}
                  </For>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>
      </div>

      <div class="border-t border-border-subtle bg-surface-muted px-16 py-10 text-12 text-content-secondary">
        <Show when={query()} fallback="No search filter">
          query="{query()}"
        </Show>
        {' · '}
        refresh={refreshMs() === 0 ? 'off' : `${refreshMs()}ms`}
        {' · '}
        visible={visibleColumns().map((column) => column.id).join(', ')}
      </div>
    </div>
  );
}
