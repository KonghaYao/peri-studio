import { DropdownMenu as KDropdownMenu } from '@kobalte/core/dropdown-menu';
import { For, type JSX } from 'solid-js';
import { cn } from '@/lib/cn';

export interface MenuItem {
  id: string;
  label: string;
  icon?: JSX.Element;
  danger?: boolean;
  disabled?: boolean;
}

export function DropdownMenu(props: {
  trigger: JSX.Element;
  items: MenuItem[];
  onSelect?: (id: string) => void;
  label?: string;
}) {
  return (
    <KDropdownMenu placement="bottom-start">
      <KDropdownMenu.Trigger as="span" class="inline-flex">{props.trigger}</KDropdownMenu.Trigger>
      <KDropdownMenu.Portal>
        <KDropdownMenu.Content
          aria-label={props.label}
          class="z-(--z-overlay) min-w-40 rounded-md border border-border-subtle bg-surface-overlay p-1 shadow-overlay outline-none"
        >
          <For each={props.items}>
            {(item) => (
              <KDropdownMenu.Item
                disabled={item.disabled}
                onSelect={() => props.onSelect?.(item.id)}
                class={cn(
                  'flex h-(--control-height-md) cursor-pointer items-center gap-2 rounded-sm px-3 text-13 outline-none',
                  item.danger ? 'text-danger-solid' : 'text-content-primary',
                  'data-[highlighted]:bg-interaction-hover data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45',
                )}
              >
                {item.icon}
                {item.label}
              </KDropdownMenu.Item>
            )}
          </For>
        </KDropdownMenu.Content>
      </KDropdownMenu.Portal>
    </KDropdownMenu>
  );
}
