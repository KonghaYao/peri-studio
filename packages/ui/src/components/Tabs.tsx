import type { Component, ComponentProps, JSX, ValidComponent } from 'solid-js';
import { For, Show, splitProps } from 'solid-js';
import * as TabsPrimitive from '@kobalte/core/tabs';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';
import { IconButton } from './Button';
import { Plus, X } from 'lucide-solid';

export type TabsType = 'line' | 'card';
export type TabsPosition = 'top' | 'right' | 'bottom' | 'left';

export const Tabs = TabsPrimitive.Root;

type TabsContextProps = {
  type?: TabsType;
  position?: TabsPosition;
  centered?: boolean;
};

type ListProps<T extends ValidComponent = 'div'> = TabsPrimitive.TabsListProps<T> & TabsContextProps & { class?: string };
export function TabsList<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ListProps<T>>) {
  const [local, rest] = splitProps(props as ListProps, ['class', 'type', 'position', 'centered']);
  const type = () => local.type ?? 'line';
  const position = () => local.position ?? 'top';
  const vertical = () => position() === 'left' || position() === 'right';

  return (
    <TabsPrimitive.List
      class={cn(
        'relative flex gap-16',
        vertical() ? 'flex-col border-r border-border-subtle pr-16' : 'border-b border-border-subtle',
        type() === 'card' && 'gap-8 border-0',
        local.centered && 'justify-center',
        local.class,
      )}
      {...rest}
    />
  );
}

type TriggerProps<T extends ValidComponent = 'button'> = TabsPrimitive.TabsTriggerProps<T> & {
  class?: string;
  tabType?: TabsType;
};
export function TabsTrigger<T extends ValidComponent = 'button'>(props: PolymorphicProps<T, TriggerProps<T>>) {
  const [local, rest] = splitProps(props as TriggerProps, ['class', 'tabType']);
  const card = () => local.tabType === 'card';
  return (
    <TabsPrimitive.Trigger
      class={cn(
        'cursor-pointer border-0 bg-transparent px-4 py-8 text-13 text-text-secondary transition-colors duration-120 ease-in-out outline-none hover:text-text-primary focus-visible:text-text-primary data-disabled:cursor-not-allowed data-disabled:opacity-45',
        card()
          ? 'rounded-8 border border-border-subtle px-12 data-selected:border-accent-solid data-selected:bg-surface data-selected:text-accent'
          : '-mb-px border-b-2 border-transparent data-selected:border-b-accent data-selected:font-medium data-selected:text-accent',
        local.class,
      )}
      {...rest}
    />
  );
}

type ContentProps<T extends ValidComponent = 'div'> = TabsPrimitive.TabsContentProps<T> & { class?: string };
export function TabsContent<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ContentProps<T>>) {
  const [local, rest] = splitProps(props as ContentProps, ['class']);
  return <TabsPrimitive.Content class={cn('pt-16 outline-none', local.class)} {...rest} />;
}

export const TabsIndicator: Component<ComponentProps<typeof TabsPrimitive.Indicator>> = TabsPrimitive.Indicator;

export type EditableTab = { key: string; label: string; closable?: boolean };

export type EditableTabsProps = {
  items: EditableTab[];
  activeKey?: string;
  defaultActiveKey?: string;
  onChange?: (key: string) => void;
  onEdit?: (key: string, action: 'add' | 'remove') => void;
  type?: TabsType;
  centered?: boolean;
  destroyInactiveTabPane?: boolean;
  children?: (item: EditableTab) => JSX.Element;
};

/** 可增删标签页，支持 destroyInactiveTabPane。 */
export function EditableTabs(props: EditableTabsProps) {
  const active = () => props.activeKey ?? props.defaultActiveKey ?? props.items[0]?.key;
  return (
    <Tabs value={active()} onChange={props.onChange}>
      <TabsList type={props.type} centered={props.centered}>
        <For each={props.items}>
          {(item) => (
            <div class="inline-flex items-center gap-4">
              <TabsTrigger value={item.key} tabType={props.type}>{item.label}</TabsTrigger>
              <Show when={item.closable}>
                <IconButton
                  label={`Close ${item.label}`}
                  size="sm"
                  showTooltip={false}
                  class="size-24"
                  onClick={() => props.onEdit?.(item.key, 'remove')}
                >
                  <X size={12} />
                </IconButton>
              </Show>
            </div>
          )}
        </For>
        <IconButton
          label="Add tab"
          size="sm"
          showTooltip={false}
          class="size-28"
          onClick={() => props.onEdit?.('new', 'add')}
        >
          <Plus size={14} />
        </IconButton>
      </TabsList>
      <For each={props.items}>
        {(item) => (
          <Show when={!props.destroyInactiveTabPane || item.key === active()}>
            <TabsContent value={item.key}>{props.children?.(item)}</TabsContent>
          </Show>
        )}
      </For>
    </Tabs>
  );
}
