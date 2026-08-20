import type { JSX } from 'solid-js';
import { Button, CopyButton } from '../../../components/ui';
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
  const copyText = () => table ? tableText(table, '\t') : '';
  return <div class="md-table my-12 overflow-hidden rounded-10 border border-border-subtle bg-surface">
    <div class="md-table__toolbar flex items-center justify-end gap-4 border-b border-divider px-7 py-5">
      <CopyButton text={copyText()} label="Copy table" size="compact" />
      <Button size="compact" onClick={() => downloadText(tableCsv(table), 'table.csv', 'text/csv;charset=utf-8')} aria-label="Download table as CSV">Download CSV</Button>
    </div>
    <div class="overflow-x-auto">
      <table {...props} ref={table} class="w-full min-w-420 border-collapse text-left text-13" />
    </div>
  </div>;
}
