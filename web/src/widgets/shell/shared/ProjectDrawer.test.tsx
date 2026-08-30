import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../components/ui';
import { ProjectDrawer } from './ProjectDrawer';

describe('ProjectDrawer', () => {
  it('becomes a labeled modal only on compact layouts and restores its trigger', async () => {
    const background = document.createElement('main');
    document.body.append(background);
    const trigger = document.createElement('button');
    trigger.textContent = 'Open navigation';
    document.body.append(trigger);
    trigger.focus();
    function Harness() {
      const [open, setOpen] = createSignal(true);
      return <ProjectDrawer open={open()} modal onOpenChange={setOpen}><button>First project</button><button>Last project</button></ProjectDrawer>;
    }
    render(() => <Harness />);
    const drawer = await screen.findByRole('dialog', { name: 'Projects & Sessions' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'First project' })).toHaveFocus());
    await waitFor(() => expect(background).toHaveAttribute('aria-hidden', 'true'));
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(drawer).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Projects & Sessions' })).not.toBeInTheDocument());
    await waitFor(() => expect(background).not.toHaveAttribute('aria-hidden'));
    background.remove();
    trigger.remove();
  });

  it('stays structural and non-modal on wide layouts', () => {
    render(() => <ProjectDrawer open={false} modal={false} onOpenChange={() => {}}><button>Project</button></ProjectDrawer>);
    const navigation = screen.getByText('Project').closest('aside');
    expect(navigation).not.toHaveAttribute('role');
    expect(navigation).not.toHaveAttribute('aria-modal');
    expect(navigation).not.toHaveAttribute('inert');
  });

  it('keeps the compact drawer panel above the modal scrim', async () => {
    render(() => <ProjectDrawer open modal onOpenChange={() => {}}><button>Project</button></ProjectDrawer>);
    const drawer = await screen.findByRole('dialog', { name: 'Projects & Sessions' });
    expect(drawer.className).toMatch(/max-desk:z-61/);
    expect(drawer.className).toMatch(/max-desk:translate-x-0/);
  });

  it('lets a nested Dialog consume Escape before the navigation layer', async () => {
    function Harness() {
      const [drawerOpen, setDrawerOpen] = createSignal(true);
      const [dialogOpen, setDialogOpen] = createSignal(true);
      return <ProjectDrawer open={drawerOpen()} modal onOpenChange={setDrawerOpen}><button>Project</button><Dialog open={dialogOpen()} onOpenChange={setDialogOpen}><DialogContent><DialogTitle>Create project</DialogTitle><button>Create</button></DialogContent></Dialog></ProjectDrawer>;
    }
    render(() => <Harness />);
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(screen.getByRole('dialog', { name: 'Projects & Sessions' })).toBeInTheDocument();
  });

  it('lets a nested Menu consume one Escape before the navigation layer', async () => {
    function Harness() {
      const [drawerOpen, setDrawerOpen] = createSignal(true);
      const [menuOpen, setMenuOpen] = createSignal(true);
      return <ProjectDrawer open={drawerOpen()} modal onOpenChange={setDrawerOpen}><DropdownMenu open={menuOpen()} onOpenChange={setMenuOpen}><DropdownMenuTrigger>Project actions</DropdownMenuTrigger><DropdownMenuContent aria-label="Project actions"><DropdownMenuItem>Rename</DropdownMenuItem></DropdownMenuContent></DropdownMenu></ProjectDrawer>;
    }
    render(() => <Harness />);
    await waitFor(() => expect(screen.getByRole('menu', { name: 'Project actions' })).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Projects & Sessions' })).toBeInTheDocument();
  });
});
