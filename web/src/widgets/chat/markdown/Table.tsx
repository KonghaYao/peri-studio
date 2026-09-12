import type { JSX } from 'solid-js';
import { CopyButton, DownloadIcon, IconButton } from '@peri/ui';
import { downloadText } from './download';

function tableText(table: HTMLTableElement, separator: string) {
  return Array.from(table.rows).map((row) => Array.from(row.cells).map((cell) => cell.textContent?.trim() || '').join(separator)).join('\n');
}

function tableCsv(table: HTMLTableElement) {
  return Array.from(table.rows).map((row) => Array.from(row.cells).map((cell) => {
    const value = cell.textContent?.trim() || '';
    return `"${value.replace(/"/g, '""')}"`;
  }).join(',')).join('\n');
}

export function MarkdownTable(props: JSX.HTMLAttributes<HTMLTableElement>) {
  let table!: HTMLTableElement;
  const copyText = () => (table ? tableText(table, '\t') : '');
  return (
    <div class="md-table group/md-table relative my-16 overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay" data-testid="md-table">
      <div
        class="absolute top-6 right-6 z-10 flex gap-2 rounded-md border border-border-subtle bg-surface-overlay/95 p-2 opacity-0 shadow-raised transition-opacity duration-(--duration-fast) group-hover/md-table:opacity-100 group-focus-within/md-table:opacity-100"
        role="toolbar"
        aria-label="Table actions"
      >
        <CopyButton text={copyText()} label="Copy table" size="compact" />
        <IconButton size="compact" label="Download table as CSV" onClick={() => downloadText(tableCsv(table), 'table.csv', 'text/csv;charset=utf-8')}>
          <DownloadIcon />
        </IconButton>
      </div>
      <div class="overflow-x-auto">
        <table {...props} ref={table} class="w-full border-collapse text-left text-13" />
      </div>
    </div>
  );
}
