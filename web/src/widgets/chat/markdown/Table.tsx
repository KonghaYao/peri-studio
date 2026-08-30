import type { JSX } from 'solid-js';
import { CopyButton, DownloadIcon, IconButton } from '@/shared/ui';
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
  return <div class="md-table my-(--markdown-rich-block-gap) overflow-hidden rounded-10 border border-border-subtle bg-surface">
    <div class="md-table__toolbar flex items-center justify-end gap-4 border-b border-divider px-7 py-5">
      <CopyButton text={copyText()} label="Copy table" size="compact" />
      <IconButton size="compact" onClick={() => downloadText(tableCsv(table), 'table.csv', 'text/csv;charset=utf-8')} label="Download table as CSV"><DownloadIcon /></IconButton>
    </div>
    <div class="overflow-x-auto">
      <table {...props} ref={table} class="w-full min-w-[420px] border-collapse text-left text-13" />
    </div>
  </div>;
}
