import { createSignal, Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';
import {
  LevelCountsDisplay,
  levelCountsFromRecord,
  MONITOR_LEVEL_SYMBOLS,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableInlineError,
  TableLoadingRows,
  TableRow,
} from '@peri/ui';

const SAMPLE_LEVEL_COUNTS = levelCountsFromRecord({
  errorCount: 2,
  warningCount: 1,
  debugCount: 0,
});

/** Display catalog · 表格 loading/error/level counts T2 演示。 */
export function ComponentCatalogExtrasTableState(props: { sections?: string[] }) {
  const [retryCount, setRetryCount] = createSignal(0);

  return (
    <>
      <Show when={showCatalogSection(props.sections, 'level-counts-display')}>
        <CatalogDemo
          id="level-counts-display"
          title="LevelCountsDisplay"
          description="Non-zero observation level counts in a compact horizontal row（自 peri-fuse traces table）。"
        >
          <DemoRow label="Ready">
            <LevelCountsDisplay counts={SAMPLE_LEVEL_COUNTS} />
          </DemoRow>
          <DemoRow label="Loading">
            <div class="w-200">
              <LevelCountsDisplay counts={[]} isLoading />
            </div>
          </DemoRow>
          <DemoRow label="Symbols">
            <span class="text-12 text-content-muted">
              ERROR {MONITOR_LEVEL_SYMBOLS.ERROR} · WARNING {MONITOR_LEVEL_SYMBOLS.WARNING} · DEBUG{' '}
              {MONITOR_LEVEL_SYMBOLS.DEBUG}
            </span>
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'table-loading-rows')}>
        <CatalogDemo
          id="table-loading-rows"
          title="TableLoadingRows"
          description="Skeleton placeholder rows for table views while data is loading."
        >
          <TableLoadingRows rows={3} columns={4} class="rounded-8 border border-border-subtle" />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'table-inline-error')}>
        <CatalogDemo
          id="table-inline-error"
          title="TableInlineError"
          description="Inline table/query failure with optional retry and action slot（无 401→Settings 硬编码）。"
        >
          <DemoRow label="Initial load failure">
            <div class="w-full max-w-640">
              <TableInlineError
                title="Could not load traces."
                error={new Error('Gateway returned 503')}
                onRetry={() => setRetryCount((count) => count + 1)}
                retryLabel={`Retry (${retryCount()})`}
              />
            </div>
          </DemoRow>
          <DemoRow label="Stale refresh">
            <div class="w-full max-w-640">
              <TableInlineError error={new Error('Refresh timed out')} isStale />
            </div>
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'table-state-composed')}>
        <CatalogDemo
          id="table-state-composed"
          title="Table state composed"
          description="LevelCountsDisplay inside a compact traces-style table row."
        >
          <Table class="w-full text-12">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Observation levels</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Checkout latency probe</TableCell>
                <TableCell>
                  <LevelCountsDisplay counts={SAMPLE_LEVEL_COUNTS} />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CatalogDemo>
      </Show>
    </>
  );
}
