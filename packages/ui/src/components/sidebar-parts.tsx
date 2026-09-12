import { cva, type VariantProps } from 'class-variance-authority';
import type { Component, ComponentProps } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../lib/cn';
import { useSidebar } from './Sidebar';

export const SidebarHeader: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-sidebar="header"
      class={cn('flex flex-col gap-8 p-8', local.class)}
      {...rest}
    />
  );
};

export const SidebarFooter: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-sidebar="footer"
      class={cn('flex flex-col gap-8 p-8', local.class)}
      {...rest}
    />
  );
};

export const SidebarContent: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-sidebar="content"
      class={cn(
        'ui-scrollbar flex min-h-0 flex-1 flex-col gap-8 overflow-auto group-data-[collapsible=icon]:overflow-hidden',
        local.class,
      )}
      {...rest}
    />
  );
};

export const SidebarRail: Component<ComponentProps<'button'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'onClick']);
  const { toggleSidebar } = useSidebar();
  const onClick = local.onClick;
  return (
    <button
      type="button"
      aria-label="Toggle Sidebar"
      title="Toggle Sidebar"
      data-sidebar="rail"
      onClick={(event) => {
        if (typeof onClick === 'function') onClick(event);
        toggleSidebar();
      }}
      class={cn(
        'absolute inset-y-0 z-20 hidden w-16 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-2 hover:after:bg-sidebar-resize-handle-hover group-data-[side=left]:-right-16 group-data-[side=right]:left-0 desk:flex',
        local.class,
      )}
      {...rest}
    />
  );
};

export const SidebarGroup: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-sidebar="group"
      class={cn('relative flex w-full min-w-0 flex-col p-8', local.class)}
      {...rest}
    />
  );
};

export const SidebarGroupLabel: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-sidebar="group-label"
      class={cn(
        'flex h-32 shrink-0 items-center rounded-6 px-8 text-12 font-medium text-content-muted outline-none transition-[margin,opacity] duration-200 ease-linear group-data-[collapsible=icon]:-mt-32 group-data-[collapsible=icon]:opacity-0',
        local.class,
      )}
      {...rest}
    />
  );
};

export const SidebarGroupAction: Component<ComponentProps<'button'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <button
      type="button"
      data-sidebar="group-action"
      class={cn(
        'absolute right-12 top-14 flex aspect-square w-20 items-center justify-center rounded-6 p-0 text-content-primary outline-none transition-transform hover:bg-interaction-hover hover:text-content-primary focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2 group-data-[collapsible=icon]:hidden',
        local.class,
      )}
      {...rest}
    />
  );
};

export const SidebarGroupContent: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-sidebar="group-content"
      class={cn('w-full text-13', local.class)}
      {...rest}
    />
  );
};

export const SidebarMenu: Component<ComponentProps<'ul'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <ul
      data-sidebar="menu"
      class={cn('flex w-full min-w-0 flex-col gap-4', local.class)}
      {...rest}
    />
  );
};

export const SidebarMenuItem: Component<ComponentProps<'li'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <li
      data-sidebar="menu-item"
      class={cn('group/menu-item relative', local.class)}
      {...rest}
    />
  );
};

const sidebarMenuButtonVariants = cva(
  'peer/menu-button flex w-full items-center gap-8 overflow-hidden rounded-6 p-8 text-left text-13 text-content-primary outline-none transition-[width,height,padding] hover:bg-interaction-hover hover:text-content-primary focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 data-[active=true]:bg-sidebar-selected data-[active=true]:font-medium data-[active=true]:text-content-primary [&>span:last-child]:truncate [&>svg]:size-16 [&>svg]:shrink-0 group-data-[collapsible=icon]:size-36! group-data-[collapsible=icon]:p-8!',
  {
    variants: {
      variant: {
        default: 'hover:bg-interaction-hover hover:text-content-primary',
        outline:
          'border border-border-subtle bg-surface shadow-sm hover:bg-interaction-hover hover:text-content-primary',
      },
      size: {
        default: 'h-36 text-13',
        sm: 'h-28 text-12',
        lg: 'h-44 text-13 group-data-[collapsible=icon]:p-0!',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type SidebarMenuButtonProps = ComponentProps<'button'> &
  VariantProps<typeof sidebarMenuButtonVariants> & {
    isActive?: boolean;
  };

export const SidebarMenuButton: Component<SidebarMenuButtonProps> = (props) => {
  const [local, variants, rest] = splitProps(props, ['class', 'isActive'], ['variant', 'size']);
  return (
    <button
      type="button"
      data-sidebar="menu-button"
      data-active={local.isActive ? 'true' : undefined}
      class={cn(
        sidebarMenuButtonVariants({
          variant: variants.variant,
          size: variants.size,
        }),
        local.class,
      )}
      {...rest}
    />
  );
};

export const SidebarMenuAction: Component<ComponentProps<'button'> & { showOnHover?: boolean }> = (
  props,
) => {
  const [local, rest] = splitProps(props, ['class', 'showOnHover']);
  return (
    <button
      type="button"
      data-sidebar="menu-action"
      class={cn(
        'absolute right-4 top-6 flex aspect-square w-28 items-center justify-center rounded-6 p-0 text-content-primary outline-none transition-transform hover:bg-interaction-hover hover:text-content-primary focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2 peer-hover/menu-button:text-content-primary group-data-[collapsible=icon]:hidden',
        local.showOnHover &&
          'group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 peer-data-[active=true]/menu-button:text-content-primary desk:opacity-0',
        local.class,
      )}
      {...rest}
    />
  );
};

export const SidebarMenuBadge: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-sidebar="menu-badge"
      class={cn(
        'pointer-events-none absolute right-4 flex h-20 min-w-20 select-none items-center justify-center rounded-6 px-4 text-10 font-medium tabular-nums text-content-primary group-data-[collapsible=icon]:hidden',
        local.class,
      )}
      {...rest}
    />
  );
};

export const SidebarMenuSub: Component<ComponentProps<'ul'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <ul
      data-sidebar="menu-sub"
      class={cn(
        'mx-14 flex min-w-0 translate-x-px flex-col gap-4 border-l border-border-faint px-14 py-4 group-data-[collapsible=icon]:hidden',
        local.class,
      )}
      {...rest}
    />
  );
};

export const SidebarMenuSubItem: Component<ComponentProps<'li'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <li data-sidebar="menu-sub-item" class={cn(local.class)} {...rest} />;
};

type SidebarMenuSubButtonProps = ComponentProps<'a'> & {
  isActive?: boolean;
  size?: 'sm' | 'md';
};

export const SidebarMenuSubButton: Component<SidebarMenuSubButtonProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'isActive', 'size']);
  const size = () => local.size ?? 'md';
  return (
    <a
      data-sidebar="menu-sub-button"
      data-active={local.isActive ? 'true' : undefined}
      data-size={size()}
      class={cn(
        'flex h-28 min-w-0 -translate-x-px items-center gap-8 overflow-hidden rounded-6 px-8 text-content-primary outline-none hover:bg-interaction-hover hover:text-content-primary focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2 active:bg-interaction-hover active:text-content-primary disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 data-[active=true]:bg-sidebar-selected data-[active=true]:text-content-primary',
        size() === 'sm' && 'text-12',
        size() === 'md' && 'text-13',
        'group-data-[collapsible=icon]:hidden',
        '[&>span:last-child]:truncate [&>svg]:size-16 [&>svg]:shrink-0',
        local.class,
      )}
      {...rest}
    />
  );
};
