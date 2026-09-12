import { PanelLeft } from 'lucide-solid';
import type { Accessor, Component, ComponentProps, JSX } from 'solid-js';
import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  Show,
  splitProps,
  useContext,
} from 'solid-js';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { Sheet, SheetContent } from './Sheet';

export const SIDEBAR_KEYBOARD_SHORTCUT = 'b';
const SIDEBAR_MOBILE_QUERY = '(max-width: 959px)';

export type SidebarState = 'expanded' | 'collapsed';
export type SidebarCollapsible = 'offcanvas' | 'icon' | 'none';
export type SidebarVariant = 'sidebar' | 'floating' | 'inset';
export type SidebarSide = 'left' | 'right';

export type SidebarContextValue = {
  state: Accessor<SidebarState>;
  open: Accessor<boolean>;
  setOpen: (open: boolean) => void;
  openMobile: Accessor<boolean>;
  setOpenMobile: (open: boolean) => void;
  isMobile: Accessor<boolean>;
  toggleSidebar: () => void;
};

const SidebarContext = createContext<SidebarContextValue>();

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.');
  }
  return context;
}

function createIsMobile() {
  const [isMobile, setIsMobile] = createSignal(false);

  createEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(SIDEBAR_MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    onCleanup(() => mql.removeEventListener('change', onChange));
  });

  return isMobile;
}

export type SidebarProviderProps = JSX.HTMLAttributes<HTMLDivElement> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const SidebarProvider: Component<SidebarProviderProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'defaultOpen',
    'open',
    'onOpenChange',
    'class',
    'style',
    'children',
  ]);

  const isMobile = createIsMobile();
  const [openMobile, setOpenMobile] = createSignal(false);
  const [_open, _setOpen] = createSignal(local.defaultOpen ?? true);

  const open = () => local.open ?? _open();

  const setOpen = (value: boolean) => {
    local.onOpenChange?.(value);
    if (local.open === undefined) {
      _setOpen(value);
    }
  };

  const toggleSidebar = () => {
    if (isMobile()) {
      setOpenMobile((current) => !current);
      return;
    }
    setOpen(!open());
  };

  const state = (): SidebarState => (open() ? 'expanded' : 'collapsed');

  createEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
  });

  const contextValue: SidebarContextValue = {
    state,
    open,
    setOpen,
    openMobile,
    setOpenMobile,
    isMobile,
    toggleSidebar,
  };

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        style={{
          '--sidebar-width': 'var(--shell-sidebar-width)',
          '--sidebar-width-icon': 'var(--space-48)',
          ...(typeof local.style === 'object' && local.style !== null ? local.style : {}),
        }}
        class={cn('group/sidebar-wrapper flex min-h-svh w-full', local.class)}
        {...rest}
      >
        {local.children}
      </div>
    </SidebarContext.Provider>
  );
};

export type SidebarProps = JSX.HTMLAttributes<HTMLDivElement> & {
  side?: SidebarSide;
  variant?: SidebarVariant;
  collapsible?: SidebarCollapsible;
};

export const Sidebar: Component<SidebarProps> = (props) => {
  const [local, rest] = splitProps(props, ['side', 'variant', 'collapsible', 'class', 'children']);
  const side = () => local.side ?? 'left';
  const variant = () => local.variant ?? 'sidebar';
  const collapsible = () => local.collapsible ?? 'offcanvas';
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  if (collapsible() === 'none') {
    return (
      <div
        data-sidebar="sidebar"
        data-side={side()}
        data-variant={variant()}
        data-collapsible="none"
        class={cn(
          'flex h-full w-(--sidebar-width) flex-col bg-sidebar-bg text-content-primary',
          local.class,
        )}
        {...rest}
      >
        {local.children}
      </div>
    );
  }

  return (
    <Show
      when={!isMobile()}
      fallback={
        <Sheet open={openMobile()} onOpenChange={setOpenMobile}>
          <SheetContent
            side={side() === 'right' ? 'right' : 'left'}
            class="w-(--sidebar-width) border-border-faint bg-sidebar-bg p-0 text-content-primary"
            data-sidebar="sidebar"
            data-mobile="true"
          >
            <div class="flex h-full w-full flex-col">{local.children}</div>
          </SheetContent>
        </Sheet>
      }
    >
      <div
        class="group peer hidden text-content-primary desk:block"
        data-shell-aside=""
        data-state={state()}
        data-collapsible={state() === 'collapsed' ? collapsible() : ''}
        data-variant={variant()}
        data-side={side()}
      >
        <div
          aria-hidden="true"
          class={cn(
            'ui-aside-gap relative bg-transparent transition-[width] duration-200 ease-linear',
            variant() === 'floating' || variant() === 'inset'
              ? 'w-(--sidebar-width) group-data-[collapsible=icon]:w-64'
              : 'w-(--sidebar-width) group-data-[collapsible=icon]:w-(--sidebar-width-icon)',
            'group-data-[collapsible=offcanvas]:w-0',
          )}
        />
        <div
          class={cn(
            'ui-aside-container fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear desk:flex',
            side() === 'left' ? 'left-0' : 'right-0',
            'group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[collapsible=icon]:overflow-hidden',
            (variant() === 'floating' || variant() === 'inset') && 'p-8',
          )}
        >
          <div
            data-sidebar="sidebar"
            class={cn(
              'flex h-full w-full flex-col bg-sidebar-bg',
              variant() === 'floating' && 'rounded-8 border border-border-subtle shadow-popover',
              variant() === 'inset' && 'rounded-8 border border-border-subtle',
              local.class,
            )}
            {...rest}
          >
            {local.children}
          </div>
        </div>
      </div>
    </Show>
  );
};

export const SidebarInset: Component<ComponentProps<'main'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <main
      class={cn(
        'relative flex w-full flex-1 flex-col bg-surface',
        'desk:peer-data-[variant=inset]:m-8 desk:peer-data-[variant=inset]:ml-0 desk:peer-data-[variant=inset]:rounded-8 desk:peer-data-[variant=inset]:shadow-sm desk:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-8',
        local.class,
      )}
      {...rest}
    />
  );
};

export const SidebarTrigger: Component<ComponentProps<'button'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'onClick']);
  const { toggleSidebar } = useSidebar();
  const onClick = local.onClick;
  return (
    <Button
      variant="ghost"
      size="sm"
      data-sidebar="trigger"
      class={cn('size-36', local.class)}
      onClick={(event) => {
        if (typeof onClick === 'function') onClick(event);
        toggleSidebar();
      }}
      {...rest}
    >
      <PanelLeft class="size-16" />
      <span class="sr-only">Toggle Sidebar</span>
    </Button>
  );
};

export {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from './sidebar-parts';
