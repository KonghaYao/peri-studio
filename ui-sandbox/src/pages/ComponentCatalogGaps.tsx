import { Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  AspectRatio,
  Attachments,
  Avatar,
  AvatarFallback,
  BackToTop,
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
  Checkbox,
  CheckboxControl,
  CheckboxInput,
  CheckboxLabel,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  CopyButton,
  FormDialogShell,
  GitGraphRefBadge,
  GitStatusBadge,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Kbd,
  LinkButton,
  Listbox,
  ListboxItem,
  ListboxItemLabel,
  LoadingState,
  NativeSelect,
  NativeSelectOption,
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  RadioGroup,
  RadioGroupItem,
  RadioGroupItemControl,
  RadioGroupItemInput,
  RadioGroupItemLabel,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  ScrollArea,
  ScrollAreaViewport,
  SelectField,
  Shimmer,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Terminal,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
} from '@peri/ui';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

export function ComponentCatalogGaps(props: { sections?: string[] }) {
  return (
    <>
      <Show when={showCatalogSection(props.sections, 'checkbox-radio')}>
        <CatalogDemo id="checkbox-radio" title="Checkbox & RadioGroup" description="独立表单选择控件 demo。">
          <DemoRow>
            <Checkbox checked class="inline-flex items-center gap-8">
              <CheckboxInput /><CheckboxControl /><CheckboxLabel>Checked</CheckboxLabel>
            </Checkbox>
            <RadioGroup value="a">
              <RadioGroupItem value="a" class="inline-flex items-center gap-8">
                <RadioGroupItemInput /><RadioGroupItemControl /><RadioGroupItemLabel>Option A</RadioGroupItemLabel>
              </RadioGroupItem>
            </RadioGroup>
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'avatar-scroll-aspect')}>
        <CatalogDemo id="avatar-scroll-aspect" title="Avatar · ScrollArea · AspectRatio">
          <DemoRow>
            <Avatar><AvatarFallback>PS</AvatarFallback></Avatar>
            <ScrollArea class="h-80 w-200 rounded-8 border border-border-subtle">
              <ScrollAreaViewport class="p-8 text-12">Long scrollable content for catalog preview.</ScrollAreaViewport>
            </ScrollArea>
            <AspectRatio ratio={16 / 9} class="w-160 overflow-hidden rounded-8 border border-border-subtle bg-surface-sunken" />
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'skeleton-loading')}>
        <CatalogDemo id="skeleton-loading" title="Skeleton · LoadingState · Shimmer">
          <DemoRow>
            <Skeleton class="h-32 w-200" />
            <LoadingState label="Loading projection" />
            <Shimmer class="h-32 w-200 rounded-8" />
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'hover-context')}>
        <CatalogDemo id="hover-context" title="HoverCard & ContextMenu">
          <ContextMenu>
            <ContextMenuTrigger class="rounded-8 border border-border-subtle px-12 py-8 text-13">Right click me</ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem>Copy path</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <HoverCard>
            <HoverCardTrigger class="text-13 text-accent">Hover citation</HoverCardTrigger>
            <HoverCardContent>Hover card preview content.</HoverCardContent>
          </HoverCard>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'navigation-menu')}>
        <CatalogDemo id="navigation-menu" title="NavigationMenu">
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuLink href="#/components">Components</NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'select-primitives')}>
        <CatalogDemo id="select-primitives" title="Listbox · NativeSelect · SelectField">
          <div class="max-w-xs rounded-8 border border-border-subtle px-12 py-8 text-13 text-content-secondary">
            Listbox demo — use Combobox section for interactive list.
          </div>
          <NativeSelect class="max-w-xs">
            <NativeSelectOption value="a">Native A</NativeSelectOption>
          </NativeSelect>
          <SelectField label="Model">
            <option value="gpt">GPT</option>
          </SelectField>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'toggle-kbd-command')}>
        <CatalogDemo id="toggle-kbd-command" title="Toggle · Kbd · Command">
          <ToggleGroup value="bold">
            <ToggleGroupItem value="bold">Bold</ToggleGroupItem>
          </ToggleGroup>
          <Toggle pressed aria-label="Italic">Italic</Toggle>
          <Kbd>Ctrl</Kbd>
          <p class="text-13 text-content-secondary">Command palette — see Combobox page for full interactive demo.</p>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'form-dialog-shell')}>
        <CatalogDemo id="form-dialog-shell" title="FormDialogShell">
          <div class="rounded-8 border border-border-subtle">
            <FormDialogShell title="Rename project" description="Visible in catalog only.">
              <p class="text-13 text-content-secondary">Dialog shell with form slot.</p>
            </FormDialogShell>
          </div>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'back-to-top')}>
        <CatalogDemo id="back-to-top" title="BackToTop">
          <div class="relative h-120 overflow-hidden rounded-8 border border-border-subtle">
            <BackToTop />
          </div>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'ai-primitives')}>
        <CatalogDemo id="ai-primitives" title="ChainOfThought · Reasoning · Attachments · PromptInput">
          <ChainOfThought>
            <ChainOfThoughtHeader>Planning</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep status="complete" label="Read files" />
            </ChainOfThoughtContent>
          </ChainOfThought>
          <Reasoning>
            <ReasoningTrigger>Why this answer</ReasoningTrigger>
            <ReasoningContent>Model reasoning preview.</ReasoningContent>
          </Reasoning>
          <Attachments variant="grid" />
          <PromptInputProvider>
            <PromptInput>
              <PromptInputBody><PromptInputTextarea placeholder="Prompt input preview" /></PromptInputBody>
              <PromptInputFooter><PromptInputSubmit /></PromptInputFooter>
            </PromptInput>
          </PromptInputProvider>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'copy-link-terminal-git')}>
        <CatalogDemo id="copy-link-terminal-git" title="CopyButton · LinkButton · Terminal · Git badges">
          <DemoRow>
            <CopyButton text="peri-studio" />
            <LinkButton href="#/home">Docs</LinkButton>
            <GitStatusBadge status="modified" />
            <GitGraphRefBadge gitRef={{ label: 'main', tone: 'branch' }} />
          </DemoRow>
          <Terminal class="h-120" />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'table-primitives')}>
        <CatalogDemo id="table-primitives" title="Table primitives">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>Alpha</TableCell><TableCell>Ready</TableCell></TableRow>
            </TableBody>
          </Table>
        </CatalogDemo>
      </Show>
    </>
  );
}
