import { For } from 'solid-js';
import type { RenderableNode } from '../lib/node-helpers';
import { getNodeList } from '../lib/node-helpers';
import type { MarkdownRenderContext } from './context';
import { RenderChildren } from './RenderChildren';

function tableText(table: HTMLTableElement, separator: string) {
  return Array.from(table.rows).map((row) => Array.from(row.cells).map((cell) => cell.textContent?.trim() || '').join(separator)).join('\n');
}

function tableCsv(table: HTMLTableElement) {
  return Array.from(table.rows).map((row) => Array.from(row.cells).map((cell) => {
    const value = cell.textContent?.trim() || '';
    return `"${value.replace(/"/g, '""')}"`;
  }).join(',')).join('\n');
}

function DynamicCell(props: { tag: 'th' | 'td'; align?: string; children: unknown }) {
  const style = props.align ? `text-align:${props.align}` : undefined;
  const className = 'border border-border-subtle px-10 py-8 align-top';
  if (props.tag === 'th') return <th style={style} class={className}>{props.children as never}</th>;
  return <td style={style} class={className}>{props.children as never}</td>;
}

export function TableNode(props: { node: RenderableNode; context: MarkdownRenderContext }) {
  let table!: HTMLTableElement;
  const header = () => getNodeList((props.node as { header?: { cells?: RenderableNode[] } }).header?.cells);
  const rows = () => getNodeList((props.node as { rows?: RenderableNode[] }).rows);

  const renderCell = (cell: RenderableNode, tag: 'th' | 'td') => (
    <DynamicCell tag={tag} align={(cell as { align?: string }).align}>
      <RenderChildren nodes={getNodeList((cell as { children?: RenderableNode[] }).children)} context={props.context} />
    </DynamicCell>
  );

  return (
    <div class="md-table group/md-table relative my-16 overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay" data-testid="md-table">
      <div
        class="absolute top-6 right-6 z-10 flex gap-2 rounded-md border border-border-subtle bg-surface-overlay/95 p-2 opacity-0 shadow-raised transition-opacity duration-(--duration-fast) group-hover/md-table:opacity-100 group-focus-within/md-table:opacity-100"
        role="toolbar"
        aria-label="Table actions"
      >
        <button type="button" class="rounded-md border border-border-subtle px-8 py-4 text-12" onClick={() => void navigator.clipboard.writeText(tableText(table, '\t'))}>
          Copy table
        </button>
        <button
          type="button"
          class="rounded-md border border-border-subtle px-8 py-4 text-12"
          aria-label="Download table as CSV"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([tableCsv(table)], { type: 'text/csv;charset=utf-8' }));
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'table.csv';
            anchor.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download table as CSV
        </button>
      </div>
      <div class="overflow-x-auto">
        <table ref={table} class="w-full border-collapse text-left text-13">
          <thead>
            <tr>
              <For each={header()}>{(cell) => renderCell(cell, 'th')}</For>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(row) => (
                <tr>
                  <For each={getNodeList((row as { cells?: RenderableNode[] }).cells)}>
                    {(cell) => renderCell(cell, 'td')}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
}
