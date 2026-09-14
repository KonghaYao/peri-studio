import { Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  LocalIsoDate,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TruncatedIdCell,
} from '@peri/ui';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

const SAMPLE_TIMESTAMP = new Date(Date.UTC(2024, 5, 15, 14, 30, 45, 123));

const TABLE_ROWS = [
  {
    id: 'trace_01HXYZabcdefghijklmnopqrstuvwxyz',
    name: 'Summarize trace latency for checkout flow',
    timestamp: SAMPLE_TIMESTAMP,
  },
  {
    id: 'trace_01ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    name: 'Browser regression · sidebar resize',
    timestamp: new Date(SAMPLE_TIMESTAMP.getTime() - 86_400_000),
  },
] as const;

/** Display catalog · 表格 id/name 与时间列 T2 演示。 */
export function ComponentCatalogExtrasTableCells(props: { sections?: string[] }) {
  return (
    <>
      <Show when={showCatalogSection(props.sections, 'truncated-id-cell')}>
        <CatalogDemo
          id="truncated-id-cell"
          title="TruncatedIdCell"
          description="Single-line id/name cells with native title or Tooltip overflow（自 peri-fuse table-id）。"
        >
          <DemoRow label="Native title">
            <div class="w-120 rounded-6 border border-border-subtle bg-surface px-8 py-6">
              <TruncatedIdCell value={TABLE_ROWS[0].id} />
            </div>
          </DemoRow>
          <DemoRow label="Tooltip">
            <div class="w-120 rounded-6 border border-border-subtle bg-surface px-8 py-6">
              <TruncatedIdCell value={TABLE_ROWS[0].name} tooltip />
            </div>
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'local-iso-date')}>
        <CatalogDemo
          id="local-iso-date"
          title="LocalIsoDate"
          description="Local timezone ISO rendering with UTC millisecond tooltip（自 peri-fuse LocalIsoDate）。"
        >
          <DemoRow label="Second (default)">
            <LocalIsoDate date={SAMPLE_TIMESTAMP} />
          </DemoRow>
          <DemoRow label="Day">
            <LocalIsoDate date={SAMPLE_TIMESTAMP} accuracy="day" />
          </DemoRow>
          <DemoRow label="Millisecond">
            <LocalIsoDate date={SAMPLE_TIMESTAMP} accuracy="millisecond" />
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'table-cells-composed')}>
        <CatalogDemo
          id="table-cells-composed"
          title="Table cells composed"
          description="TruncatedIdCell + LocalIsoDate in a compact table row."
        >
          <Table class="w-full text-12">
            <TableHeader>
              <TableRow>
                <TableHead class="w-120">Trace ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead class="w-160">Timestamp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TABLE_ROWS.map((row) => (
                <TableRow>
                  <TableCell>
                    <TruncatedIdCell value={row.id} />
                  </TableCell>
                  <TableCell>
                    <TruncatedIdCell value={row.name} tooltip />
                  </TableCell>
                  <TableCell>
                    <LocalIsoDate date={row.timestamp} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CatalogDemo>
      </Show>
    </>
  );
}
