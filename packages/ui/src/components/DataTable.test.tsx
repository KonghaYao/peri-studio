import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, For } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  useDataTable,
  type DataTableColumn,
} from './DataTable';

type Row = { name: string; score: number };

const rows: Row[] = [
  { name: 'Beta', score: 20 },
  { name: 'Alpha', score: 10 },
  { name: 'Gamma', score: 30 },
];

const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Name', accessor: (row) => row.name, sortable: true },
  { id: 'score', header: 'Score', accessor: (row) => row.score, sortable: true },
];

afterEach(() => cleanup());

describe('DataTable', () => {
  it('renders declarative rows and cycles sort on column click', () => {
    render(() => <DataTable data={rows} columns={columns} />);

    const frame = screen.getByRole('table').closest('[data-slot="data-table"]');
    expect(frame).toHaveClass('rounded-8', 'border-border-subtle', 'bg-surface');
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('data-sortable', '');
    expect(screen.getAllByRole('row')).toHaveLength(4);

    const nameHeader = screen.getByRole('button', { name: /Name/ });
    fireEvent.click(nameHeader);
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'Alpha',
      '10',
      'Beta',
      '20',
      'Gamma',
      '30',
    ]);
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'ascending');

    fireEvent.click(nameHeader);
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'Gamma',
      '30',
      'Beta',
      '20',
      'Alpha',
      '10',
    ]);
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'descending');

    fireEvent.click(nameHeader);
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'none');
  });

  it('supports controlled sort state via onSortChange', () => {
    const onSortChange = vi.fn();
    render(() => (
      <DataTable
        data={rows}
        columns={columns}
        sort={{ columnId: 'score', direction: 'asc' }}
        onSortChange={onSortChange}
      />
    ));

    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'Alpha',
      '10',
      'Beta',
      '20',
      'Gamma',
      '30',
    ]);

    fireEvent.click(screen.getByRole('button', { name: /Score/ }));
    expect(onSortChange).toHaveBeenCalledWith({ columnId: 'score', direction: 'desc' });
  });

  it('composes children and exposes sorted data through useDataTable', () => {
    function BodyRows() {
      const table = useDataTable<Row>();
      return (
        <For each={table.sortedData()}>
          {(row) => (
            <DataTableRow>
              <DataTableCell>{row.name}</DataTableCell>
              <DataTableCell>{row.score}</DataTableCell>
            </DataTableRow>
          )}
        </For>
      );
    }

    render(() => (
      <DataTable data={rows} columns={columns}>
        <DataTableHeader>
          <DataTableRow>
            <DataTableHead column="name" sortable>Name</DataTableHead>
            <DataTableHead column="score" sortable>Score</DataTableHead>
          </DataTableRow>
        </DataTableHeader>
        <DataTableBody>
          <BodyRows />
        </DataTableBody>
      </DataTable>
    ));

    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'Alpha',
      '10',
      'Beta',
      '20',
      'Gamma',
      '30',
    ]);
  });

  it('keeps uncontrolled sort state in children mode', () => {
    const [sort, setSort] = createSignal<{ columnId: string; direction: 'asc' | 'desc' } | null>(null);

    render(() => (
      <DataTable data={rows} sort={sort()} onSortChange={setSort}>
        <DataTableHeader>
          <DataTableRow>
            <DataTableHead column="score" sortable>Score</DataTableHead>
          </DataTableRow>
        </DataTableHeader>
        <DataTableBody>
          <DataTableRow>
            <DataTableCell>placeholder</DataTableCell>
          </DataTableRow>
        </DataTableBody>
      </DataTable>
    ));

    fireEvent.click(screen.getByRole('button', { name: /Score/ }));
    expect(sort()).toEqual({ columnId: 'score', direction: 'asc' });
  });
});
