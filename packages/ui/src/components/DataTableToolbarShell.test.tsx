import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTableToolbarShell } from './DataTableToolbarShell';

afterEach(() => cleanup());

describe('DataTableToolbarShell', () => {
  const columns = [
    { id: 'name', label: 'Name', visible: true },
    { id: 'score', label: 'Score', visible: false },
    { id: 'actions', label: 'Actions', visible: true, hideable: false },
  ];

  it('renders toolbar slot and columns trigger', () => {
    render(() => (
      <DataTableToolbarShell
        columns={columns}
        toolbar={<span>Filter bar</span>}
      />
    ));

    expect(screen.getByText('Filter bar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Columns' })).toBeInTheDocument();
  });

  it('lists hideable columns and omits hideable=false', async () => {
    render(() => (
      <DataTableToolbarShell columns={columns} />
    ));

    const trigger = screen.getByRole('button', { name: 'Columns' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Score' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('calls onColumnVisibilityChange when toggling a column', async () => {
    const onColumnVisibilityChange = vi.fn();
    render(() => (
      <DataTableToolbarShell
        columns={columns}
        onColumnVisibilityChange={onColumnVisibilityChange}
      />
    ));

    const trigger = screen.getByRole('button', { name: 'Columns' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const scoreItem = await screen.findByRole('menuitemcheckbox', { name: 'Score' });
    fireEvent.pointerDown(scoreItem);
    fireEvent.pointerUp(scoreItem);
    expect(onColumnVisibilityChange).toHaveBeenCalledWith('score', true);
  });

  it('hides columns menu when no hideable columns exist', () => {
    render(() => (
      <DataTableToolbarShell
        columns={[{ id: 'id', label: 'ID', visible: true, hideable: false }]}
      />
    ));

    expect(screen.queryByRole('button', { name: 'Columns' })).not.toBeInTheDocument();
  });

  it('supports controlled visibility updates', async () => {
    const [visible, setVisible] = createSignal(true);
    render(() => (
      <DataTableToolbarShell
        columns={[{ id: 'name', label: 'Name', visible: visible() }]}
        onColumnVisibilityChange={(_, next) => setVisible(next)}
      />
    ));

    const trigger = screen.getByRole('button', { name: 'Columns' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const item = await screen.findByRole('menuitemcheckbox', { name: 'Name' });
    expect(item).toHaveAttribute('aria-checked', 'true');

    fireEvent.pointerDown(item);
    fireEvent.pointerUp(item);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Name' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});
