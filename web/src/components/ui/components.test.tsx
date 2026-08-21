import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './Collapsible';
import { Button, IconButton } from './Button';
import { Icon } from './Icon';
import { Badge } from './Badge';
import { CopyButton } from './CopyButton';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from './Dialog';
import { Checkbox, CheckboxControl, CheckboxInput, CheckboxLabel } from './Checkbox';
import { TextField } from './Field';
import { Listbox, ListboxItem } from './Listbox';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';
import { Status } from './Status';
import { RadioGroup, RadioGroupItem, RadioGroupItemControl, RadioGroupItemInput, RadioGroupItemLabel } from './RadioGroup';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs';
import { Textarea } from './Textarea';
import { SelectField } from './SelectField';
import { EmptyState } from './EmptyState';
import { InlineNotice } from './InlineNotice';
import { LoadingState } from './LoadingState';
import { Spinner } from './Spinner';
import { showToast, Toaster } from './Toast';
import { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip';

describe('Collapsible', () => {
  it('keeps controlled disclosure state and the trigger relationship intact', () => {
    const onOpenChange = vi.fn();
    render(() => <Collapsible open={false} onOpenChange={onOpenChange}><CollapsibleTrigger>Archived sessions</CollapsibleTrigger><CollapsibleContent id="archived-list">Archived row</CollapsibleContent></Collapsible>);
    const trigger = screen.getByRole('button', { name: 'Archived sessions' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Archived row')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});

describe('Listbox', () => {
  it('owns single-selection, disabled options, and arrow-key focus', async () => {
    const onChange = vi.fn();
    const options = [{ id: 'one', label: 'One', disabled: false }, { id: 'two', label: 'Two', disabled: true }];
    render(() => <Listbox options={options} optionValue="id" optionTextValue="label" optionDisabled="disabled" onChange={onChange} renderItem={(item) => <ListboxItem item={item}>{item.rawValue.label}</ListboxItem>} />);
    const listbox = screen.getByRole('listbox');
    const [first, second] = screen.getAllByRole('option');
    expect(second).toHaveAttribute('aria-disabled', 'true');
    fireEvent.focusIn(listbox);
    await Promise.resolve();
    expect(first).toHaveFocus();
    fireEvent.click(first);
    const [value] = onChange.mock.calls[0] ?? [];
    expect([...value]).toEqual(['one']);
  });
});

describe('Button', () => {
  it('keeps component-only props out of the DOM and locks while busy', () => {
    render(() => <Button variant="primary" size="compact" busy data-testid="button">Save</Button>);
    const button = screen.getByTestId('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toHaveAttribute('variant');
    expect(button).not.toHaveAttribute('busy');
    expect(button).not.toHaveAttribute('size');
    expect(button).toHaveTextContent('Processing');
  });

  it('keeps secondary safety decisions neutral and semantic', () => {
    render(() => <Button variant="secondary">Decline</Button>);
    const button = screen.getByRole('button', { name: 'Decline' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('variant');
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
    expect(icon).toBeInTheDocument();
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
    expect(badge).toHaveTextContent('Pending');
    expect(badge).not.toHaveAttribute('tone');
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
    expect(status).toHaveTextContent('Reconnecting');
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

describe('Textarea', () => {
  it('forwards normal props and hides component-only auto-growth controls', () => {
    render(() => <Textarea autoResize maxHeight={180} aria-label="Message" />);
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    expect(textarea).not.toHaveAttribute('autoresize');
    expect(textarea).not.toHaveAttribute('maxheight');
    fireEvent.input(textarea, { target: { value: 'Draft' } });
    expect(textarea).toHaveValue('Draft');
  });

  it('connects its label, hint and error when rendered as a field', () => {
    render(() => <Textarea variant="field" label="Instruction" hint="Keep it concise" error="Instruction is required" />);
    const textarea = screen.getByRole('textbox', { name: 'Instruction' });
    expect(textarea).toHaveAccessibleDescription('Keep it concise Instruction is required');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).not.toHaveAttribute('variant');
  });
});

describe('Kobalte selection primitives', () => {
  it('keeps tabs controlled with semantic relationships and arrow navigation', () => {
    function Harness() {
      const [value, setValue] = createSignal('topology');
      return <Tabs value={value()} onChange={setValue}><TabsList aria-label="Categories"><TabsTrigger value="topology">Topology</TabsTrigger><TabsTrigger value="about">About</TabsTrigger></TabsList><TabsContent value="topology">Topology panel</TabsContent><TabsContent value="about">About panel</TabsContent></Tabs>;
    }
    render(() => <Harness />);
    const topology = screen.getByRole('tab', { name: 'Topology' });
    fireEvent.keyDown(topology, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('About panel');
  });

  it('keeps virtual listbox selection controlled', () => {
    const choose = vi.fn();
    const options = [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }];
    render(() => <Listbox options={options} optionValue="id" optionTextValue="label" shouldUseVirtualFocus value={['one']} onChange={(value) => choose([...value][0])} aria-label="Commands" renderItem={(item) => <ListboxItem item={item}>{item.rawValue.label}</ListboxItem>} />);
    fireEvent.click(screen.getByRole('option', { name: 'Two' }));
    expect(choose).toHaveBeenCalledWith('two');
  });

  it('uses native radio and checkbox inputs with controlled state', () => {
    function Harness() {
      const [radio, setRadio] = createSignal('safe');
      const [checked, setChecked] = createSignal(false);
      return <><RadioGroup aria-label="Mode" value={radio()} onChange={setRadio}><RadioGroupItem value="safe"><RadioGroupItemInput /><RadioGroupItemControl /><RadioGroupItemLabel>Safe</RadioGroupItemLabel></RadioGroupItem><RadioGroupItem value="fast"><RadioGroupItemInput /><RadioGroupItemControl /><RadioGroupItemLabel>Fast</RadioGroupItemLabel></RadioGroupItem></RadioGroup><Checkbox checked={checked()} onChange={setChecked}><CheckboxInput /><CheckboxControl /><CheckboxLabel>Tests</CheckboxLabel></Checkbox></>;
    }
    render(() => <Harness />);
    fireEvent.click(screen.getByRole('radio', { name: 'Fast' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tests' }));
    expect(screen.getByRole('radio', { name: 'Fast' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Tests' })).toBeChecked();
  });
});

describe('Spinner', () => {
  it('only exposes a status when it has a label and can be explicitly decorative', () => {
    const labeled = render(() => <Spinner label="Loading session" />);
    expect(screen.getByRole('status', { name: 'Loading session' })).not.toHaveAttribute('aria-hidden');
    labeled.unmount();

    const decorative = render(() => <Spinner decorative />);
    const spinner = decorative.container.querySelector('span[aria-hidden="true"]');
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('LoadingState', () => {
  it('owns one polite live region and keeps its spinner decorative', () => {
    render(() => <LoadingState label="Checking connection" description="Contacting the local server" data-testid="loading" />);
    const loading = screen.getByRole('status', { name: 'Checking connection' });
    expect(loading).toHaveAttribute('aria-live', 'polite');
    expect(loading).toHaveTextContent('Contacting the local server');
    expect(loading.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(loading).not.toHaveAttribute('label');
    expect(loading).not.toHaveAttribute('description');
  });
});

describe('Popover', () => {
  it('keeps its portal-mounted dialog surface accessible', async () => {
    render(() => <Popover open><PopoverTrigger>Details</PopoverTrigger><PopoverContent aria-label="Details">Popover details</PopoverContent></Popover>);
    expect(await screen.findByRole('dialog', { name: 'Details' })).toHaveTextContent('Popover details');
  });
});

describe('InlineNotice', () => {
  it('uses alert semantics for danger and only enables live updates when requested', () => {
    const { unmount } = render(() => <InlineNotice tone="danger" title="Import failed">The server rejected the request.</InlineNotice>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Import failed');
    expect(alert).not.toHaveAttribute('aria-live');
    unmount();

    render(() => <InlineNotice live tone="warning">Waiting for confirmation</InlineNotice>);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});

describe('EmptyState', () => {
  it('supports an inline surface without changing its title, description and action contract', () => {
    render(() => <EmptyState variant="inline" title="No sessions" description="Import an ACP session to continue." action={<Button>Import session</Button>} data-testid="empty" />);
    const empty = screen.getByTestId('empty');
    expect(empty).toHaveTextContent('No sessions');
    expect(screen.getByRole('heading', { name: 'No sessions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import session' })).toBeInTheDocument();
    expect(empty).not.toHaveAttribute('variant');
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Copied' })).toHaveTextContent('');
    expect(writeText).toHaveBeenCalledWith('exact source');
  });

  it('reports clipboard failure instead of pretending success', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(() => <CopyButton text="source" label="Copy" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy failed' })).toBeInTheDocument());
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
    const backdrop = document.querySelector('[data-dialog-overlay]');
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
    fireEvent.pointerDown(document.querySelector('[data-dialog-overlay]')!);
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
