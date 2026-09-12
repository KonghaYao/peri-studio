import { For, Show, splitProps, type ComponentProps, type JSX } from 'solid-js';
import {
  Badge,
  type BadgeTone,
  Button,
  ButtonGroup,
  buttonGroupItemClass,
  Checkbox as CheckboxRoot,
  CheckboxControl,
  CheckboxInput,
  CheckboxLabel,
  CopyButton,
  Dialog as DialogRoot,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu as DropdownMenuRoot,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton as IconButtonRoot,
  InlineNotice,
  type InlineNoticeTone,
  Input,
  RadioGroup as RadioGroupRoot,
  RadioGroupItem,
  RadioGroupItemControl,
  RadioGroupItemInput,
  RadioGroupItemLabel,
  Select,
  type SelectOption,
  Skeleton,
  Spinner,
  Status as StatusRoot,
  Tabs as TabsRoot,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  cn,
} from '@peri/ui';

export {
  Badge,
  type BadgeTone,
  Button,
  ButtonGroup,
  buttonGroupItemClass,
  CopyButton,
  EmptyState,
  InlineNotice,
  type InlineNoticeTone,
  Input,
  Select,
  type SelectOption,
  Skeleton,
  Spinner,
  Textarea,
  Tooltip,
  cn,
};

/** Catalog IconButton: map sandbox `tooltip` to package `title`. */
export function IconButton(props: ComponentProps<typeof IconButtonRoot> & { tooltip?: string }) {
  const [local, rest] = splitProps(props, ['tooltip']);
  return <IconButtonRoot title={local.tooltip ?? rest.title} {...rest} />;
}

export type NoticeTone = InlineNoticeTone;

export interface MenuItem {
  id: string;
  label: string;
  icon?: JSX.Element;
  danger?: boolean;
  disabled?: boolean;
}

/** Catalog 高层 Dialog：组合 @peri/ui 原语，不复制 T2 实现。 */
export function Dialog(props: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  children: JSX.Element;
  footer?: JSX.Element;
  width?: string;
}) {
  return (
    <DialogRoot open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent style={props.width ? { width: props.width, 'max-width': props.width } : undefined}>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogClose />
        </DialogHeader>
        <div class="px-20 py-16 text-13 leading-normal text-content-secondary">{props.children}</div>
        <Show when={props.footer}>
          <DialogFooter>{props.footer}</DialogFooter>
        </Show>
      </DialogContent>
    </DialogRoot>
  );
}

/** Catalog 高层菜单：组合 @peri/ui DropdownMenu 原语。 */
export function DropdownMenu(props: {
  trigger: JSX.Element;
  items: MenuItem[];
  onSelect?: (id: string) => void;
  label?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <DropdownMenuRoot placement="bottom-start" open={props.open} onOpenChange={props.onOpenChange}>
      <DropdownMenuTrigger as="span" class="inline-flex">{props.trigger}</DropdownMenuTrigger>
      <DropdownMenuContent aria-label={props.label}>
        <For each={props.items}>
          {(item) => (
            <DropdownMenuItem
              disabled={item.disabled}
              class={item.danger ? 'text-danger' : undefined}
              onSelect={() => props.onSelect?.(item.id)}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          )}
        </For>
      </DropdownMenuContent>
    </DropdownMenuRoot>
  );
}

export function Tabs(props: {
  tabs: { value: string; label: JSX.Element }[];
  value?: string;
  onChange?: (value: string) => void;
  class?: string;
}) {
  return (
    <TabsRoot value={props.value} onChange={props.onChange} class={props.class}>
      <TabsList>
        <For each={props.tabs}>
          {(tab) => <TabsTrigger value={tab.value}>{tab.label}</TabsTrigger>}
        </For>
      </TabsList>
    </TabsRoot>
  );
}

export function Checkbox(props: {
  label?: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <CheckboxRoot
      class="inline-flex cursor-pointer items-center gap-8 data-disabled:cursor-not-allowed"
      checked={props.checked}
      onChange={props.onChange}
      disabled={props.disabled}
    >
      <CheckboxInput />
      <CheckboxControl />
      <Show when={props.label}>
        <CheckboxLabel>{props.label}</CheckboxLabel>
      </Show>
    </CheckboxRoot>
  );
}

export function RadioGroup(props: {
  options: { value: string; label: string }[];
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <RadioGroupRoot
      value={props.value}
      onChange={props.onChange}
      disabled={props.disabled}
      name={props.name}
      class="flex flex-col gap-8"
    >
      <For each={props.options}>
        {(option) => (
          <RadioGroupItem value={option.value} class="inline-flex cursor-pointer items-center gap-8">
            <RadioGroupItemInput />
            <RadioGroupItemControl />
            <RadioGroupItemLabel class="text-13 text-content-primary">{option.label}</RadioGroupItemLabel>
          </RadioGroupItem>
        )}
      </For>
    </RadioGroupRoot>
  );
}

export function Status(props: { tone?: BadgeTone; label?: string; live?: boolean; class?: string; children?: JSX.Element }) {
  return (
    <StatusRoot tone={props.tone} live={props.live} class={props.class}>
      {props.children ?? props.label}
    </StatusRoot>
  );
}
