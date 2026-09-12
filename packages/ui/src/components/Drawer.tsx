import type { Component, ComponentProps, JSX, ValidComponent } from 'solid-js';
import { createContext, splitProps, useContext } from 'solid-js';
import * as DialogPrimitive from '@kobalte/core/dialog';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';
import { IconButton } from './Button';

export type DrawerSwipeDirection = 'up' | 'down' | 'left' | 'right';

type DrawerContextValue = {
  swipeDirection: () => DrawerSwipeDirection;
  showSwipeHandle: () => boolean;
};

const DrawerContext = createContext<DrawerContextValue>();

function useDrawerContext(component: string) {
  const context = useContext(DrawerContext);
  if (!context) {
    throw new Error(`${component} must be used within <Drawer>.`);
  }
  return context;
}

type DrawerRootProps = DialogPrimitive.DialogRootProps & {
  swipeDirection?: DrawerSwipeDirection;
  showSwipeHandle?: boolean;
};

export function Drawer(props: DrawerRootProps) {
  const [local, rest] = splitProps(props, ['swipeDirection', 'showSwipeHandle']);
  const context: DrawerContextValue = {
    swipeDirection: () => local.swipeDirection ?? 'down',
    showSwipeHandle: () => local.showSwipeHandle ?? false,
  };
  return (
    <DrawerContext.Provider value={context}>
      <DialogPrimitive.Root data-drawer {...rest} />
    </DrawerContext.Provider>
  );
}

export const DrawerTrigger = DialogPrimitive.Trigger;

const drawerDirectionClasses: Record<DrawerSwipeDirection, string> = {
  down:
    'inset-x-0 bottom-0 max-h-(--container-dialog-tall) rounded-t-8 border-t data-[expanded]:slide-in-from-bottom data-[closed]:slide-out-to-bottom',
  up:
    'inset-x-0 top-0 max-h-(--container-dialog-tall) rounded-b-8 border-b data-[expanded]:slide-in-from-top data-[closed]:slide-out-to-top',
  left:
    'inset-y-0 left-0 h-full w-(--container-drawer) rounded-r-8 border-r data-[expanded]:slide-in-from-left data-[closed]:slide-out-to-left',
  right:
    'inset-y-0 right-0 h-full w-(--container-drawer) rounded-l-8 border-l data-[expanded]:slide-in-from-right data-[closed]:slide-out-to-right',
};

const drawerSwipeAxis: Record<DrawerSwipeDirection, 'x' | 'y'> = {
  down: 'y',
  up: 'y',
  left: 'x',
  right: 'x',
};

type OverlayProps<T extends ValidComponent = 'div'> = DialogPrimitive.DialogOverlayProps<T> & { class?: string };
function DrawerOverlay<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, OverlayProps<T>>) {
  const [local, rest] = splitProps(props as OverlayProps, ['class']);
  return (
    <DialogPrimitive.Overlay
      data-drawer-overlay
      class={cn('fixed inset-0 z-60 bg-scrim', local.class)}
      {...rest}
    />
  );
}

const DrawerSwipeHandle: Component = () => {
  const { swipeDirection } = useDrawerContext('DrawerSwipeHandle');
  const direction = swipeDirection();
  const axis = drawerSwipeAxis[direction];
  return (
    <div
      data-drawer-swipe-handle
      aria-hidden="true"
      class={cn(
        'shrink-0 rounded-full bg-border-strong',
        axis === 'y' && 'mx-auto h-4 w-36',
        axis === 'x' && 'my-auto h-36 w-4',
        direction === 'down' && 'mt-12 mb-4',
        direction === 'up' && 'mt-4 mb-12',
        direction === 'left' && 'ml-4 mr-12',
        direction === 'right' && 'ml-12 mr-4',
      )}
    />
  );
};

type ContentProps<T extends ValidComponent = 'div'> = DialogPrimitive.DialogContentProps<T> & {
  class?: string;
  children?: JSX.Element;
  overlayClass?: string;
};
export function DrawerContent<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ContentProps<T>>) {
  const [local, rest] = splitProps(props as ContentProps, ['class', 'children', 'overlayClass']);
  const { swipeDirection, showSwipeHandle } = useDrawerContext('DrawerContent');
  const direction = swipeDirection();
  const axis = drawerSwipeAxis[direction];
  return (
    <DialogPrimitive.Portal>
      <DrawerOverlay class={local.overlayClass} />
      <DialogPrimitive.Content
        data-drawer-content
        data-swipe-direction={direction}
        data-swipe-axis={axis}
        class={cn(
          'group/drawer-content fixed z-61 flex flex-col overflow-hidden border border-border-subtle bg-surface text-text-primary shadow-popover outline-none transition ease-in-out data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:duration-300 data-[expanded]:duration-500 motion-reduce:transition-none motion-reduce:animate-none',
          drawerDirectionClasses[direction],
          local.class,
        )}
        {...rest}
      >
        {showSwipeHandle() ? <DrawerSwipeHandle /> : null}
        {local.children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DrawerTitle<T extends ValidComponent = 'h2'>(props: PolymorphicProps<T, DialogPrimitive.DialogTitleProps<T> & { class?: string }>) {
  const [local, rest] = splitProps(props as DialogPrimitive.DialogTitleProps & { class?: string }, ['class']);
  return (
    <DialogPrimitive.Title
      class={cn('text-14 font-semibold leading-20 text-text-primary', local.class)}
      {...rest}
    />
  );
}

export function DrawerDescription<T extends ValidComponent = 'p'>(props: PolymorphicProps<T, DialogPrimitive.DialogDescriptionProps<T> & { class?: string }>) {
  const [local, rest] = splitProps(props as DialogPrimitive.DialogDescriptionProps & { class?: string }, ['class']);
  return (
    <DialogPrimitive.Description
      class={cn('text-13 leading-20 text-content-muted', local.class)}
      {...rest}
    />
  );
}

export const DrawerHeader: Component<ComponentProps<'header'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <header class={cn('flex flex-col gap-8 px-20 py-16', local.class)} {...rest} />;
};

export const DrawerFooter: Component<ComponentProps<'footer'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <footer
      class={cn('mt-auto flex flex-col-reverse gap-8 border-t border-border-subtle px-20 py-12 sm:flex-row sm:justify-end', local.class)}
      {...rest}
    />
  );
};

type CloseProps<T extends ValidComponent = 'button'> = DialogPrimitive.DialogCloseButtonProps<T> & {
  class?: string;
  children?: JSX.Element;
  'aria-label'?: string;
};
export function DrawerClose<T extends ValidComponent = 'button'>(props: PolymorphicProps<T, CloseProps<T>>) {
  const [local, rest] = splitProps(props as CloseProps, ['class', 'children', 'aria-label']);
  const label = local['aria-label'] ?? 'Close';
  return (
    <DialogPrimitive.CloseButton
      as={IconButton}
      label={label}
      variant="ghost"
      size="compact"
      showTooltip={false}
      class={cn('text-22 font-300 text-text-muted hover:text-text-primary', local.class)}
      aria-label={label}
      {...rest}
    >
      {local.children ?? '×'}
    </DialogPrimitive.CloseButton>
  );
}
