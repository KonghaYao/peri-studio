import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { PaginationControls } from './Pagination';
import { TableView } from './TableView';

afterEach(() => cleanup());

describe('TableView', () => {
  it('renders root layout slots', () => {
    render(() => (
      <TableView data-testid="users-table">
        <TableView.Toolbar>
          <span>Filters</span>
        </TableView.Toolbar>
        <TableView.Body>
          <div data-slot="table-scroll">Rows</div>
        </TableView.Body>
        <TableView.Footer>
          <PaginationControls current={1} pageSize={25} total={100} showTotal />
        </TableView.Footer>
      </TableView>
    ));

    expect(screen.getByTestId('users-table')).toHaveAttribute('data-slot', 'table-view');
    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByText('Rows').closest('[data-slot="table-scroll"]')).toBeInTheDocument();
    expect(screen.getByText('Total 100 items')).toBeInTheDocument();
  });

  it('renders ServerTable with toolbar and pagination footer', () => {
    render(() => (
      <TableView.ServerTable
        data={[{ id: 'a', name: 'Alpha' }]}
        columns={[
          { id: 'id', header: 'ID', accessor: (row) => row.id },
          { id: 'name', header: 'Name', accessor: (row) => row.name, hideable: true },
        ]}
        rowKey={(row) => row.id}
        toolbar={<span>Search</span>}
        showColumnToggle
        pagination={{
          current: 2,
          pageSize: 10,
          total: 42,
        }}
      />
    ));

    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Columns' })).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Total 42 items')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '2' })).toHaveAttribute('aria-current', 'page');
  });
});
