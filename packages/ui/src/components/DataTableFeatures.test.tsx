import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnhancedDataTable } from './DataTableFeatures';

type Row = { name: string; score: number };

const rows: Row[] = [
  { name: 'Alpha', score: 10 },
  { name: 'Beta', score: 20 },
];

const columns = [
  { id: 'name', header: 'Name', accessor: (row: Row) => row.name, sortable: true },
  { id: 'score', header: 'Score', accessor: (row: Row) => row.score, sortable: true },
];

afterEach(() => cleanup());

describe('EnhancedDataTable', () => {
  it('renders without toolbar by default', () => {
    render(() => <EnhancedDataTable data={rows} columns={columns} />);

    expect(screen.queryByTestId('enhanced-data-table-toolbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Columns' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Name/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Score/ })).toBeInTheDocument();
  });

  it('renders toolbar slot when toolbar is provided', () => {
    render(() => (
      <EnhancedDataTable
        data={rows}
        columns={columns}
        toolbar={<span>Filter bar</span>}
      />
    ));

    expect(screen.getByTestId('enhanced-data-table-toolbar')).toBeInTheDocument();
    expect(screen.getByText('Filter bar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Columns' })).not.toBeInTheDocument();
  });

  it('renders Columns menu when showColumnToggle is enabled', async () => {
    render(() => (
      <EnhancedDataTable data={rows} columns={columns} showColumnToggle />
    ));

    expect(screen.getByTestId('enhanced-data-table-toolbar')).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Columns' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Score' })).toBeInTheDocument();
  });

  it('hides columns from the table when toggled off', async () => {
    render(() => (
      <EnhancedDataTable data={rows} columns={columns} showColumnToggle />
    ));

    const trigger = screen.getByRole('button', { name: 'Columns' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const scoreItem = await screen.findByRole('menuitemcheckbox', { name: 'Score' });
    fireEvent.pointerDown(scoreItem);
    fireEvent.pointerUp(scoreItem);

    expect(screen.getByRole('columnheader', { name: /Name/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Score/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'Alpha',
      'Beta',
    ]);
  });

  it('calls onColumnVisibilityChange when column visibility changes', async () => {
    const onColumnVisibilityChange = vi.fn();
    render(() => (
      <EnhancedDataTable
        data={rows}
        columns={columns}
        showColumnToggle
        onColumnVisibilityChange={onColumnVisibilityChange}
      />
    ));

    const trigger = screen.getByRole('button', { name: 'Columns' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const scoreItem = await screen.findByRole('menuitemcheckbox', { name: 'Score' });
    fireEvent.pointerDown(scoreItem);
    fireEvent.pointerUp(scoreItem);

    expect(onColumnVisibilityChange).toHaveBeenCalledWith({ score: false });
  });

  it('respects hideable=false on column definitions', async () => {
    render(() => (
      <EnhancedDataTable
        data={rows}
        columns={[
          ...columns,
          { id: 'actions', header: 'Actions', accessor: () => '—', hideable: false },
        ]}
        showColumnToggle
      />
    ));

    const trigger = screen.getByRole('button', { name: 'Columns' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Name' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Actions/ })).toBeInTheDocument();
  });
});
