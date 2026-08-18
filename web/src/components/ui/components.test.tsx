import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { Button, IconButton } from './Button';
import { Icon } from './Icon';
import { Badge } from './Badge';
import { CopyButton } from './CopyButton';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from './Dialog';
import { ProjectDrawer as Drawer } from '../../panel/components/shared/ProjectDrawer';
import { TextField } from './Field';
import { Markdown } from '../../panel/components/Markdown';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';
import { Status } from './Status';
import { Textarea } from './Textarea';
import { SelectField } from './SelectField';
import { showToast, Toaster } from './Toast';
import { primaryShortcut } from '../../panel/lib/keyboard';
import { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip';

describe('Button', () => {
  it('keeps component-only props out of the DOM and locks while busy', () => {
    render(() => <Button variant="primary" size="compact" busy data-testid="button">Save</Button>);
    const button = screen.getByTestId('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toHaveAttribute('variant');
    expect(button).not.toHaveAttribute('busy');
    expect(button).not.toHaveAttribute('size');
    expect(button).toHaveClass('ui-button--compact');
    expect(button).toHaveTextContent('Processing');
  });

  it('keeps secondary safety decisions neutral and semantic', () => {
    render(() => <Button variant="secondary">Decline</Button>);
    expect(screen.getByRole('button', { name: 'Decline' })).toHaveClass('ui-button--secondary');
  });

  it('describes custom icon help without repeating its action label', () => {
    const { unmount } = render(() => <IconButton label="Archive" title="Close the running session first">×</IconButton>);
    const button = screen.getByRole('button', { name: 'Archive' });
    fireEvent.focusIn(button);
    expect(button).toHaveAccessibleDescription('Close the running session first');
    unmount();
    render(() => <IconButton label="Create session">+</IconButton>);
    const repeated = screen.getByRole('button', { name: 'Create session' });
    fireEvent.focusIn(repeated);
    expect(repeated).not.toHaveAttribute('aria-describedby');
  });

  it('never submits a surrounding form unless submit is explicit', () => {
    const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(() => <form onSubmit={submit}><Button>Cancel</Button><Button type="submit">Save</Button></form>);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(submit).toHaveBeenCalledOnce();
  });
});

describe('Icon', () => {
  it('owns a finite outline canvas and remains hidden from accessibility APIs', () => {
    const { container } = render(() => <Icon><circle cx="10" cy="10" r="5" /></Icon>);
    const icon = container.querySelector('svg');
    expect(icon).toHaveClass('ui-icon', 'ui-icon--default');
    expect(icon).toHaveAttribute('viewBox', '0 0 20 20');
    expect(icon).toHaveAttribute('fill', 'none');
    expect(icon).toHaveAttribute('stroke', 'currentColor');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).not.toHaveAttribute('tabindex');
  });
});

describe('Tooltip', () => {
  it('uses Kobalte trigger and portal content', async () => {
    render(() => <Tooltip open><TooltipTrigger>New</TooltipTrigger><TooltipContent>Create a session</TooltipContent></Tooltip>);
    const button = screen.getByRole('button', { name: 'New' });
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Create a session');
    expect(document.body.contains(tooltip)).toBe(true);
    expect(button).toHaveAttribute('aria-describedby', tooltip.id);
  });

  it('closes through controlled state', async () => {
    function Harness() {
      const [open, setOpen] = createSignal(true);
      return <Tooltip open={open()} onOpenChange={setOpen}><TooltipTrigger>Actions</TooltipTrigger><TooltipContent>Session actions</TooltipContent></Tooltip>;
    }
    render(() => <Harness />);
    const button = screen.getByRole('button', { name: 'Actions' });
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(button, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });
});

describe('Badge', () => {
  it('owns a closed semantic tone without leaking component props', () => {
    render(() => <Badge tone="warn" data-testid="badge">Pending</Badge>);
    const badge = screen.getByTestId('badge');
    expect(badge).toHaveClass('ui-badge--warn');
    expect(badge).not.toHaveAttribute('tone');
    expect(badge).toHaveTextContent('Pending');
  });
});

describe('TextField', () => {
  it('owns an explicit label and hint relationship without leaking props', () => {
    render(() => <TextField label="Project" hint="Absolute path" />);
    const input = screen.getByRole('textbox', { name: 'Project' });
    expect(input).toHaveAccessibleDescription('Absolute path');
    expect(input).not.toHaveAttribute('label');
    expect(input).not.toHaveAttribute('hint');
  });

  it('owns invalid state and connects hint plus error text', () => {
    render(() => <TextField label="Session name" hint="Shown in the sidebar" error="Name is required" />);
    const input = screen.getByRole('textbox', { name: 'Session name' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Shown in the sidebar Name is required');
    expect(input).not.toHaveAttribute('error');
  });
});

describe('Status', () => {
  it('owns semantic tone and optional live behavior without leaking props', () => {
    render(() => <Status tone="warn" live data-testid="status">Reconnecting</Status>);
    const status = screen.getByTestId('status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveClass('ui-status--warn');
    expect(status).not.toHaveAttribute('tone');
    expect(status).not.toHaveAttribute('live');
  });
});

describe('Toast', () => {
  it('renders notifications through Kobalte live-region semantics', async () => {
    render(() => <Toaster />);
    showToast('Saved');
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});

describe('keyboard labels', () => {
  it('uses the visible platform modifier instead of claiming every user has Command', () => {
    const platform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux x86_64' });
    expect(primaryShortcut('k')).toBe('Ctrl+K');
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
    expect(primaryShortcut('k')).toBe('⌘K');
    Object.defineProperty(navigator, 'platform', { configurable: true, value: platform });
  });
});

describe('Textarea', () => {
  it('forwards normal props and hides component-only auto-growth controls', () => {
    render(() => <Textarea autoResize maxHeight={180} aria-label="Message" />);
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    expect(textarea).not.toHaveAttribute('autoresize');
    expect(textarea).not.toHaveAttribute('maxheight');
    fireEvent.input(textarea, { target: { value: 'Draft' } });
    expect(textarea).toHaveValue('Draft');
  });
});

describe('SelectField', () => {
  it('owns label, hint and error relationships without leaking component props', () => {
    render(() => <SelectField label="Save to project" hint="Choose persistent location" error="Select a project"><option value="p1">Perihelion</option></SelectField>);
    const select = screen.getByRole('combobox', { name: 'Save to project' });
    expect(select).toHaveAccessibleDescription('Choose persistent location Select a project');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).not.toHaveAttribute('hint');
    expect(select).not.toHaveAttribute('error');
  });
});

describe('DropdownMenuItem', () => {
  it('uses Kobalte menu semantics and supports destructive styling', () => {
    render(() => <DropdownMenu open><DropdownMenuTrigger>Actions</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem class="text-danger">Archive</DropdownMenuItem></DropdownMenuContent></DropdownMenu>);
    const item = screen.getByRole('menuitem', { name: 'Archive' });
    expect(item).toHaveAttribute('role', 'menuitem');
    expect(item).toHaveClass('text-danger');
  });
});

describe('CopyButton', () => {
  it('reports success and writes the exact source', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(() => <CopyButton text="exact source" label="Copy" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copied'));
    expect(writeText).toHaveBeenCalledWith('exact source');
  });

  it('reports clipboard failure instead of pretending success', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(() => <CopyButton text="source" label="Copy" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copy failed'));
  });
});

describe('Dialog', () => {
  it('moves focus in, closes on Escape, restores focus and releases inert', async () => {
    const app = document.createElement('div');
    app.id = 'app'; document.body.append(app);
    const outside = document.createElement('button');
    outside.textContent = 'Outside'; document.body.append(outside); outside.focus();
    let setOpen!: (value: boolean) => void;
    function Harness() {
      const [open, update] = createSignal(true); setOpen = update;
      return <Dialog open={open()} onOpenChange={setOpen}><DialogContent><DialogTitle class="sr-only">Rename</DialogTitle><input aria-label="Name" /></DialogContent></Dialog>;
    }
    render(() => <Harness />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus());
    const backdrop = document.querySelector('.ui-dialog-backdrop');
    expect(document.body.contains(backdrop)).toBe(true);
    expect(app.contains(backdrop)).toBe(false);
    expect(app).toHaveAttribute('aria-hidden', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(app).not.toHaveAttribute('aria-hidden'));
    expect(document.activeElement).not.toBe(screen.queryByRole('dialog'));
    app.remove(); outside.remove();
  });

  it('lets only the topmost nested dialog consume Escape', async () => {
    const app = document.createElement('div');
    app.id = 'app'; document.body.append(app);
    let setOuter!: (value: boolean) => void;
    let setInner!: (value: boolean) => void;
    function Harness() {
      const [outer, updateOuter] = createSignal(true); setOuter = updateOuter;
      const [inner, updateInner] = createSignal(true); setInner = updateInner;
      return <><Dialog open={outer()} onOpenChange={setOuter}><DialogContent><DialogTitle>Outer</DialogTitle><button>Outer action</button></DialogContent></Dialog><Dialog open={inner()} onOpenChange={setInner}><DialogContent><DialogTitle>Inner</DialogTitle><button>Inner action</button></DialogContent></Dialog></>;
    }
    render(() => <Harness />);
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument();
    expect(document.body).toHaveStyle({ 'pointer-events': 'none' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(app).not.toHaveAttribute('aria-hidden'));
    app.remove();
  });

  it('does not imply dismissal while a dialog owns an in-flight mutation', async () => {
    const close = vi.fn();
    render(() => <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent dismissible={false}><DialogTitle>Saving</DialogTitle><button>Working</button></DialogContent></Dialog>);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Saving' })).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(document.querySelector('.ui-dialog-backdrop')!);
    expect(close).not.toHaveBeenCalled();
  });

  it('can own a visible title and explicit close action', async () => {
    const close = vi.fn();
    render(() => <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent><DialogHeader><DialogTitle>Search sessions</DialogTitle><DialogClose aria-label="Close Search sessions">×</DialogClose></DialogHeader><input aria-label="Query" /></DialogContent></Dialog>);
    expect(screen.getByRole('heading', { name: 'Search sessions' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close Search sessions' }));
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('Drawer', () => {
  it('becomes a labeled modal only on compact layouts and restores its trigger', async () => {
    const background = document.createElement('main');
    document.body.append(background);
    const trigger = document.createElement('button');
    trigger.textContent = 'Open navigation';
    document.body.append(trigger);
    trigger.focus();
    let close!: () => void;
    function Harness() {
      const [open, setOpen] = createSignal(true);
      close = () => setOpen(false);
      return <Drawer open={open()} modal onOpenChange={(value) => { if (!value) close(); }}><button>First project</button><button>Last project</button></Drawer>;
    }
    render(() => <Harness />);
    const drawer = await screen.findByRole('dialog', { name: 'Projects & Sessions' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'First project' })).toHaveFocus());
    expect(drawer).toHaveAttribute('role', 'dialog');
    expect(background).toHaveAttribute('aria-hidden', 'true');
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(drawer).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Projects & Sessions' })).not.toBeInTheDocument());
    await waitFor(() => expect(background).not.toHaveAttribute('aria-hidden'));
    expect(document.activeElement).not.toBe(drawer);
    background.remove(); trigger.remove();
  });

  it('stays structural and non-modal on wide layouts', () => {
    render(() => <Drawer open={false} modal={false} onOpenChange={() => {}}><button>Project</button></Drawer>);
    const navigation = screen.getByText('Project').closest('aside');
    expect(navigation).not.toHaveAttribute('role');
    expect(navigation).not.toHaveAttribute('aria-modal');
    expect(navigation).not.toHaveAttribute('inert');
    expect(screen.queryByRole('button', { name: 'Close Projects & Sessions' })).not.toBeInTheDocument();
  });

  it('lets a nested Dialog consume Escape before the navigation layer', async () => {
    const app = document.createElement('div'); app.id = 'app'; document.body.append(app);
    const background = document.createElement('main'); document.body.append(background);
    function Harness() {
      const [drawerOpen, setDrawerOpen] = createSignal(true);
      const [dialogOpen, setDialogOpen] = createSignal(true);
      return <Drawer open={drawerOpen()} modal onOpenChange={setDrawerOpen}><button>Project</button><Dialog open={dialogOpen()} onOpenChange={setDialogOpen}><DialogContent><DialogTitle>Create project</DialogTitle><button>Create</button></DialogContent></Dialog></Drawer>;
    }
    render(() => <Harness />);
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(screen.getByRole('dialog', { name: 'Projects & Sessions' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    app.remove(); background.remove();
  });

  it('lets a nested Menu consume one Escape before the navigation layer', async () => {
    const background = document.createElement('main'); document.body.append(background);
    function Harness() {
      const [drawerOpen, setDrawerOpen] = createSignal(true);
      const [menuOpen, setMenuOpen] = createSignal(true);
      return <Drawer open={drawerOpen()} modal onOpenChange={setDrawerOpen}><DropdownMenu open={menuOpen()} onOpenChange={setMenuOpen}><DropdownMenuTrigger>Project actions</DropdownMenuTrigger><DropdownMenuContent aria-label="Project actions"><DropdownMenuItem>Rename</DropdownMenuItem></DropdownMenuContent></DropdownMenu></Drawer>;
    }
    render(() => <Harness />);
    await waitFor(() => expect(screen.getByRole('menu', { name: 'Project actions' })).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Projects & Sessions' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    background.remove();
  });
});

describe('Markdown', () => {
  it('renders raw HTML and active links as inert text', () => {
    render(() => <Markdown source={'<script>alert(1)</script>\n\n[unsafe](javascript:alert(2))'} />);
    expect(document.querySelector('script')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('.markdown-body')).toHaveTextContent('unsafe');
  });

  it('isolates safe links and exposes copyable fenced code', () => {
    render(() => <Markdown source={'[docs](https://example.com)\n\n```ts\nconst x = 1;\n```'} />);
    const link = screen.getByRole('link', { name: /docs/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  });
});

describe('Popover', () => {
  it('closes on Escape', async () => {
    function Harness() {
      const [open, setOpen] = createSignal(true);
      return <Popover open={open()} onOpenChange={setOpen}><PopoverTrigger>Rename</PopoverTrigger><PopoverContent aria-label="Rename session"><input aria-label="Session name" /></PopoverContent></Popover>;
    }
    render(() => <Harness />);
    const dialog = await screen.findByRole('dialog', { name: 'Rename session' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps an in-flight edit open across Escape and outside interaction', async () => {
    const close = vi.fn();
    render(() => <Popover open onOpenChange={close}><PopoverTrigger>Rename</PopoverTrigger><PopoverContent aria-label="Rename session" onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()}><input aria-label="Session name" /></PopoverContent></Popover>);
    expect(await screen.findByRole('dialog', { name: 'Rename session' })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    expect(close).not.toHaveBeenCalled();
  });
});

describe('DropdownMenu', () => {
  it('supports arrow navigation and Escape dismissal', async () => {
    function Harness() {
      const [open, setOpen] = createSignal(true);
      return <DropdownMenu open={open()} onOpenChange={setOpen}><DropdownMenuTrigger>Actions</DropdownMenuTrigger><DropdownMenuContent aria-label="Session actions"><DropdownMenuItem>First</DropdownMenuItem><DropdownMenuItem>Second</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
    }
    render(() => <Harness />);
    await waitFor(() => expect(document.querySelector<HTMLElement>('[role="menu"]')).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });
});
