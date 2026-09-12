import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../src/components/Accordion';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../src/components/Collapsible';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../src/components/Table';
import { Toggle } from '../src/components/Toggle';
import { ToggleGroup, ToggleGroupItem } from '../src/components/ToggleGroup';
import { Button, IconButton } from '../src/components/Button';
import { ButtonGroup } from '../src/components/ButtonGroup';
import { Select } from '../src/components/Select';
import { Terminal } from '../src/components/Terminal';
import { Icon } from '../src/components/Icon';
import { Badge } from '../src/components/Badge';
import { CopyButton } from '../src/components/CopyButton';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '../src/components/Dialog';
import { Checkbox, CheckboxControl, CheckboxInput, CheckboxLabel } from '../src/components/Checkbox';
import { Label } from '../src/components/Label';
import { Separator } from '../src/components/Separator';
import { Switch, SwitchControl, SwitchInput, SwitchLabel, SwitchThumb } from '../src/components/Switch';
import { Kbd } from '../src/components/Kbd';
import { Progress, ProgressFill, ProgressLabel, ProgressTrack, ProgressValueLabel } from '../src/components/Progress';
import { Slider, SliderFill, SliderThumb, SliderTrack } from '../src/components/Slider';
import { TextField } from '../src/components/Field';
import { Listbox, ListboxItem } from '../src/components/Listbox';
import { Popover, PopoverContent, PopoverTrigger } from '../src/components/Popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../src/components/dropdown-menu';
import { Status } from '../src/components/Status';
import { RadioGroup, RadioGroupItem, RadioGroupItemControl, RadioGroupItemInput, RadioGroupItemLabel } from '../src/components/RadioGroup';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../src/components/Tabs';
import { Textarea } from '../src/components/Textarea';
import { SelectField } from '../src/components/SelectField';
import { EmptyState } from '../src/components/EmptyState';
import { Alert, AlertDescription, AlertTitle } from '../src/components/Alert';
import { Avatar, AvatarFallback, AvatarImage } from '../src/components/Avatar';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../src/components/Card';
import { InlineNotice } from '../src/components/InlineNotice';
import { LoadingState } from '../src/components/LoadingState';
import { Skeleton } from '../src/components/Skeleton';
import { Spinner } from '../src/components/Spinner';
import { dismissToast, showToast, Toaster } from '../src/components/Toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '../src/components/Tooltip';

afterEach(() => cleanup());

describe('Accordion', () => {
  it('keeps controlled expansion and trigger semantics', () => {
    const onChange = vi.fn();
    render(() => (
      <Accordion value={[]} onChange={onChange} collapsible>
        <AccordionItem value="details">
          <AccordionTrigger>Session details</AccordionTrigger>
          <AccordionContent>Expanded copy</AccordionContent>
        </AccordionItem>
      </Accordion>
    ));
    const trigger = screen.getByRole('button', { name: 'Session details' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveClass('border-border-subtle', 'justify-between');
    expect(screen.queryByText('Expanded copy')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(onChange).toHaveBeenCalledWith(['details']);
  });

  it('supports multiple expansion mode', () => {
    const onChange = vi.fn();
    render(() => (
      <Accordion multiple value={['one']} onChange={onChange}>
        <AccordionItem value="one">
          <AccordionTrigger>One</AccordionTrigger>
          <AccordionContent>Panel one</AccordionContent>
        </AccordionItem>
        <AccordionItem value="two">
          <AccordionTrigger>Two</AccordionTrigger>
          <AccordionContent>Panel two</AccordionContent>
        </AccordionItem>
      </Accordion>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Two' }));
    expect(onChange).toHaveBeenCalledWith(['one', 'two']);
  });
});

describe('Toggle', () => {
  it('reports pressed changes and keeps variant props off the DOM', () => {
    const onChange = vi.fn();
    render(() => (
      <Toggle variant="outline" pressed={false} onChange={onChange} aria-label="Bold">
        B
      </Toggle>
    ));
    const button = screen.getByRole('button', { name: 'Bold' });
    expect(button).toHaveClass('border-border-strong');
    expect(button).not.toHaveAttribute('variant');
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('ToggleGroup', () => {
  it('supports single and multiple selection', () => {
    const single = vi.fn();
    const { unmount } = render(() => (
      <ToggleGroup value="left" onChange={single}>
        <ToggleGroupItem value="left" aria-label="Align left">
          L
        </ToggleGroupItem>
        <ToggleGroupItem value="center" aria-label="Align center">
          C
        </ToggleGroupItem>
      </ToggleGroup>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Align center' }));
    expect(single).toHaveBeenCalledWith('center');
    unmount();

    const multiple = vi.fn();
    render(() => (
      <ToggleGroup multiple value={['bold']} onChange={multiple}>
        <ToggleGroupItem value="bold" aria-label="Bold">
          B
        </ToggleGroupItem>
        <ToggleGroupItem value="italic" aria-label="Italic">
          I
        </ToggleGroupItem>
      </ToggleGroup>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }));
    expect(multiple).toHaveBeenCalledWith(['bold', 'italic']);
  });
});

describe('Table', () => {
  it('renders semantic table parts with markdown-like styling', () => {
    render(() => (
      <Table>
        <TableCaption>Models</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Fast</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    ));
    expect(screen.getByRole('table')).toHaveClass('text-12', 'border-collapse');
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveClass('font-semibold', 'bg-surface-muted');
    expect(screen.getByRole('cell', { name: 'Fast' })).toHaveClass('border-border-subtle');
  });
});

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

  it('applies search and menu item recipes from tokens', () => {
    const options = [{ id: 'a', label: 'Alpha' }];
    const { unmount } = render(() => (
      <Listbox
        options={options}
        optionValue="id"
        optionTextValue="label"
        renderItem={(item) => (
          <ListboxItem item={item} recipe="search" data-testid="listbox-item">
            {item.rawValue.label}
          </ListboxItem>
        )}
      />
    ));
    expect(screen.getByTestId('listbox-item')).toHaveClass('min-h-32', 'rounded-md', 'text-content-primary');
    unmount();
    render(() => (
      <Listbox
        options={options}
        optionValue="id"
        optionTextValue="label"
        renderItem={(item) => (
          <ListboxItem item={item} recipe="menu" data-testid="listbox-item">
            {item.rawValue.label}
          </ListboxItem>
        )}
      />
    ));
    expect(screen.getByTestId('listbox-item')).toHaveClass('rounded-lg', 'px-10', 'py-6');
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
    expect(button).toHaveClass('bg-accent-solid', 'hover:bg-accent-hover');
    expect(button.className).toContain('content-on-accent');
    expect(button).not.toHaveClass('text-inherit');
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

  it('can keep sidebar icon actions accessible without rendering a tooltip', () => {
    const { container } = render(() => <IconButton label="Sidebar action" showTooltip={false}>×</IconButton>);
    const button = screen.getByRole('button', { name: 'Sidebar action' });
    expect(button).toBeVisible();
    expect(button).not.toHaveAttribute('title');
    expect(container.querySelector('.ui-tooltip-anchor')).toBeNull();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('uses rounded rectangular geometry for icon-only actions', () => {
    render(() => <><IconButton label="Default action">×</IconButton><IconButton label="Compact action" size="compact">×</IconButton></>);
    expect(screen.getByRole('button', { name: 'Default action' })).toHaveClass('size-32', 'rounded-6');
    expect(screen.getByRole('button', { name: 'Compact action' })).toHaveClass('size-24', 'rounded-6');
    expect(screen.getByRole('button', { name: 'Default action' })).not.toHaveClass('rounded-full');
  });

  it('maps variant and busy through icon button CVA', () => {
    render(() => (
      <>
        <IconButton label="Primary action" variant="primary" data-testid="primary-icon">+</IconButton>
        <IconButton label="Danger action" variant="danger" data-testid="danger-icon">×</IconButton>
        <IconButton label="Working action" busy data-testid="busy-icon">×</IconButton>
      </>
    ));
    expect(screen.getByTestId('primary-icon')).toHaveClass('bg-accent-solid');
    expect(screen.getByTestId('danger-icon')).toHaveClass('text-danger');
    const busy = screen.getByTestId('busy-icon');
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveTextContent('Processing');
    expect(busy).not.toHaveTextContent('×');
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
    expect(badge).toHaveClass('text-text-secondary');
    expect(badge.querySelector('.ui-badge__dot')).toHaveClass('bg-warning');
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

  it('can retain status semantics while hiding routine label copy', () => {
    render(() => <Status tone="ok" labelHidden data-testid="status">Online</Status>);
    const label = screen.getByText('Online');
    expect(label).toHaveClass('ui-status__label');
    expect(label).toHaveClass('sr-only');
    expect(screen.getByTestId('status')).not.toHaveAttribute('labelhidden');
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
  it('forwards one native input event exactly once', () => {
    const onInput = vi.fn();
    render(() => <Textarea aria-label="Message" onInput={onInput} />);
    fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), { target: { value: '你的 pwd 在哪里' } });
    expect(onInput).toHaveBeenCalledTimes(1);
  });

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

  it('uses field chrome by default and keeps the bare variant borderless', () => {
    const { unmount } = render(() => <Textarea aria-label="Default field" />);
    const field = screen.getByRole('textbox', { name: 'Default field' });
    expect(field).toHaveClass('w-full', 'rounded-6', 'text-13');
    expect(field).not.toHaveClass('resize-none');
    unmount();

    render(() => <Textarea variant="bare" aria-label="Bare field" />);
    const bare = screen.getByRole('textbox', { name: 'Bare field' });
    expect(bare).toHaveClass('w-full', 'resize-none');
    expect(bare).not.toHaveClass('rounded-6');
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

describe('Skeleton', () => {
  it('renders a decorative shimmer placeholder', () => {
    render(() => <Skeleton data-testid="skeleton" class="h-12 w-180" />);
    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton).toHaveClass('ui-skeleton');
    expect(skeleton).not.toHaveAttribute('role');
  });
});

describe('Popover', () => {
  it('keeps its portal-mounted dialog surface accessible', async () => {
    render(() => <Popover open><PopoverTrigger>Details</PopoverTrigger><PopoverContent aria-label="Details">Popover details</PopoverContent></Popover>);
    expect(await screen.findByRole('dialog', { name: 'Details' })).toHaveTextContent('Popover details');
  });
});

describe('Card', () => {
  it('composes header, content and footer without leaking component props', () => {
    render(() => (
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>Local development</CardDescription>
        </CardHeader>
        <CardContent>Body copy</CardContent>
        <CardFooter>
          <Button>Continue</Button>
        </CardFooter>
      </Card>
    ));
    const card = screen.getByTestId('card');
    expect(card).toHaveClass('rounded-8', 'border-border-subtle', 'bg-surface', 'shadow-none');
    expect(screen.getByText('Workspace')).toHaveClass('text-14', 'font-semibold');
    expect(screen.getByText('Local development')).toHaveClass('text-12', 'text-content-muted');
    expect(screen.getByText('Body copy')).toHaveClass('px-16', 'py-12');
    expect(screen.getByRole('button', { name: 'Continue' }).parentElement).toHaveClass('px-16', 'py-12');
    expect(card).not.toHaveAttribute('variant');
  });
});

describe('Avatar', () => {
  it('shows fallback initials until an image loads', () => {
    render(() => (
      <Avatar data-testid="avatar">
        <AvatarImage src="/avatar.png" alt="Peri" />
        <AvatarFallback>PS</AvatarFallback>
      </Avatar>
    ));
    expect(screen.getByText('PS')).toBeInTheDocument();
    const image = screen.getByRole('img', { hidden: true });
    fireEvent.load(image);
    expect(screen.queryByText('PS')).not.toBeInTheDocument();
  });

  it('keeps fallback visible when the image fails to load', () => {
    render(() => (
      <Avatar>
        <AvatarImage src="/missing.png" alt="Missing" />
        <AvatarFallback>?</AvatarFallback>
      </Avatar>
    ));
    const image = screen.getByRole('img', { hidden: true });
    fireEvent.error(image);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('renders fallback-only avatars without an image source', () => {
    render(() => (
      <Avatar data-testid="avatar">
        <AvatarFallback aria-label="Guest">G</AvatarFallback>
      </Avatar>
    ));
    expect(screen.getByTestId('avatar')).toHaveClass('size-32', 'rounded-full', 'bg-surface-muted');
    expect(screen.getByLabelText('Guest')).toHaveTextContent('G');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('Alert', () => {
  it('uses softer feedback surfaces and keeps destructive semantics', () => {
    const { unmount } = render(() => (
      <Alert data-testid="alert">
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>Review the pending changes.</AlertDescription>
      </Alert>
    ));
    const alert = screen.getByTestId('alert');
    expect(alert).toHaveClass('bg-info-soft', 'border-info-border');
    expect(alert).not.toHaveAttribute('role');
    expect(alert).not.toHaveAttribute('variant');
    unmount();

    render(() => (
      <Alert variant="destructive">
        <AlertTitle>Delete failed</AlertTitle>
        <AlertDescription>The server rejected the request.</AlertDescription>
      </Alert>
    ));
    const destructive = screen.getByRole('alert');
    expect(destructive).toHaveClass('bg-danger-soft', 'border-danger-border');
    expect(destructive).toHaveTextContent('Delete failed');
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
    await waitFor(() => {
      expect(outside.hasAttribute('inert') || outside.getAttribute('aria-hidden') === 'true').toBe(true);
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => {
      expect(outside.hasAttribute('inert')).toBe(false);
      expect(outside).not.toHaveAttribute('aria-hidden');
    });
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
    const dismiss = screen.getByRole('button', { name: 'Close Search sessions' });
    expect(dismiss).toHaveAttribute('data-icon-button');
    fireEvent.click(dismiss);
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

describe('ButtonGroup', () => {
  it('exposes a labeled group role for segmented icon actions', () => {
    render(() => (
      <ButtonGroup aria-label="Session actions">
        <IconButton label="Pin" showTooltip={false}>P</IconButton>
        <IconButton label="Archive" showTooltip={false}>A</IconButton>
      </ButtonGroup>
    ));
    const group = screen.getByRole('group', { name: 'Session actions' });
    expect(group).toHaveClass('ui-button-group');
    expect(screen.getByRole('button', { name: 'Pin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });
});

describe('Select (Kobalte)', () => {
  const modelOptions = [
    { value: 'fast', label: 'Fast', description: 'Lower latency' },
    { value: 'smart', label: 'Smart' },
  ];

  it('selects an option and reports the value without leaking list props', async () => {
    const onChange = vi.fn();
    render(() => (
      <Select
        options={modelOptions}
        value="fast"
        onChange={onChange}
        aria-label="Model"
        placeholder="Choose model"
      />
    ));
    const trigger = screen.getByRole('button', { name: /Model/ });
    expect(trigger).toHaveTextContent('Fast');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Smart' }));
    expect(onChange).toHaveBeenCalledWith('smart');
  });

  it('respects disabled and shows placeholder when value is missing', () => {
    render(() => (
      <Select
        options={modelOptions}
        disabled
        placeholder="Choose model"
        aria-label="Model"
      />
    ));
    const trigger = screen.getByRole('button', { name: /Model/ });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent('Choose model');
  });
});

describe('Terminal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes an accessible host before xterm mounts', () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
    const { container } = render(() => <Terminal visible={false} />);
    expect(screen.getByLabelText('Interactive terminal')).toHaveClass('terminal-xterm-host');
    expect(container.querySelector('.xterm')).toBeNull();
  });
});

describe('Badge legacy tones', () => {
  it('maps ok, warn, and err to semantic dot colors', () => {
    const { unmount } = render(() => <Badge tone="ok" data-testid="ok">Ok</Badge>);
    expect(screen.getByTestId('ok').querySelector('.ui-badge__dot')).toHaveClass('bg-success');
    unmount();
    render(() => <Badge tone="err" data-testid="err">Err</Badge>);
    expect(screen.getByTestId('err').querySelector('.ui-badge__dot')).toHaveClass('bg-danger');
  });
});

describe('TextField edge cases', () => {
  it('marks disabled controls and keeps error semantics', () => {
    render(() => <TextField label="Token" disabled error="Required" />);
    const input = screen.getByRole('textbox', { name: 'Token' });
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('SelectField edge cases', () => {
  it('marks disabled native select without leaking field props', () => {
    render(() => (
      <SelectField label="Project" disabled>
        <option value="p1">One</option>
      </SelectField>
    ));
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeDisabled();
  });
});

describe('CopyButton edge cases', () => {
  it('does not copy when disabled', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(() => <CopyButton text="secret" label="Copy" disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('Toast dismissal', () => {
  it('can dismiss a shown toast by id', async () => {
    render(() => <Toaster />);
    const id = showToast('Temporary');
    expect(await screen.findByText('Temporary')).toBeInTheDocument();
    dismissToast(id);
    await waitFor(() => expect(screen.queryByText('Temporary')).not.toBeInTheDocument());
  });
});

describe('EmptyState page variant', () => {
  it('renders page layout without leaking variant to the DOM', () => {
    render(() => (
      <EmptyState
        variant="page"
        title="Nothing here"
        description="Create a session to begin."
        data-testid="empty-page"
      />
    ));
    const empty = screen.getByTestId('empty-page');
    expect(empty).toHaveClass('flex-1');
    expect(empty).not.toHaveAttribute('variant');
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
  });
});

describe('Checkbox disabled', () => {
  it('blocks interaction when disabled', () => {
    const onChange = vi.fn();
    render(() => (
      <Checkbox disabled checked={false} onChange={onChange}>
        <CheckboxInput />
        <CheckboxControl />
        <CheckboxLabel>Notify</CheckboxLabel>
      </Checkbox>
    ));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Notify' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Switch', () => {
  it('toggles on click and respects disabled', () => {
    function Harness() {
      const [checked, setChecked] = createSignal(false);
      return (
        <Switch checked={checked()} onChange={setChecked}>
          <SwitchInput />
          <SwitchControl>
            <SwitchThumb />
          </SwitchControl>
          <SwitchLabel>Airplane mode</SwitchLabel>
        </Switch>
      );
    }
    render(() => <Harness />);
    const control = screen.getByRole('switch', { name: 'Airplane mode' });
    expect(control).not.toBeChecked();
    fireEvent.click(control);
    expect(control).toBeChecked();
  });

  it('blocks interaction when disabled', () => {
    const onChange = vi.fn();
    render(() => (
      <Switch disabled checked={false} onChange={onChange}>
        <SwitchInput />
        <SwitchControl>
          <SwitchThumb />
        </SwitchControl>
        <SwitchLabel>Notify</SwitchLabel>
      </Switch>
    ));
    fireEvent.click(screen.getByRole('switch', { name: 'Notify' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Label', () => {
  it('associates with control via for/id', () => {
    render(() => (
      <>
        <Label for="email">Email</Label>
        <input id="email" type="text" />
      </>
    ));
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });
});

describe('Separator', () => {
  it('renders with role separator', () => {
    render(() => <Separator data-testid="sep" />);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });
});

describe('IconButton stop variant', () => {
  it('uses stop styling for streaming cancel actions', () => {
    render(() => <IconButton label="Stop" variant="stop">■</IconButton>);
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveClass('bg-btn-primary');
  });
});

describe('Progress', () => {
  it('exposes progressbar semantics and styled track/fill for 0-100 values', () => {
    render(() => (
      <Progress value={40} data-testid="progress">
        <ProgressLabel>Upload</ProgressLabel>
        <ProgressValueLabel data-testid="value-label" />
        <ProgressTrack data-testid="track">
          <ProgressFill data-testid="fill" />
        </ProgressTrack>
      </Progress>
    ));
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByTestId('track')).toHaveClass('h-8', 'rounded-full', 'bg-border-subtle');
    expect(screen.getByTestId('fill')).toHaveClass('ui-progress-fill', 'bg-accent-solid');
    expect(screen.getByTestId('value-label')).toHaveTextContent('40%');
  });
});

describe('Slider', () => {
  it('supports controlled values, track styling, and keyboard changes', () => {
    const onChange = vi.fn();
    render(() => (
      <Slider value={[25]} onChange={onChange} aria-label="Volume">
        <SliderTrack data-testid="track">
          <SliderFill data-testid="fill" />
          <SliderThumb aria-label="Volume" data-testid="thumb" />
        </SliderTrack>
      </Slider>
    ));
    const thumb = screen.getByTestId('thumb');
    expect(thumb).toHaveAttribute('role', 'slider');
    expect(thumb).toHaveAttribute('aria-valuemin', '0');
    expect(thumb).toHaveAttribute('aria-valuemax', '100');
    expect(thumb).toHaveAttribute('aria-valuenow', '25');
    expect(thumb.className).toContain('focus-visible:shadow-accent-ring');
    expect(thumb.className).toContain('pointer-coarse:min-h-44');
    expect(screen.getByTestId('track').className).toContain('h-8');
    expect(screen.getByTestId('track').className).toContain('bg-border-subtle');
    expect(screen.getByTestId('fill').className).toContain('bg-accent-solid');
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith([26]);
  });
});

describe('Kbd', () => {
  it('renders keyboard key styling without leaking component props', () => {
    render(() => <Kbd data-testid="kbd">⌘K</Kbd>);
    const kbd = screen.getByTestId('kbd');
    expect(kbd.tagName).toBe('KBD');
    expect(kbd).toHaveClass('rounded-4', 'border-border-subtle', 'bg-surface-muted', 'px-6', 'py-2', 'font-mono', 'text-10', 'text-content-secondary');
    expect(kbd).toHaveTextContent('⌘K');
  });
});
