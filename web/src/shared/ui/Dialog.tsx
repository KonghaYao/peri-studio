import type { Component, ComponentProps, JSX, ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as DialogPrimitive from '@kobalte/core/dialog';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

type CloseProps<T extends ValidComponent = 'button'> = DialogPrimitive.DialogCloseButtonProps<T> & { class?: string };
export function DialogClose<T extends ValidComponent = 'button'>(props: PolymorphicProps<T, CloseProps<T>>) {
  const [local, rest] = splitProps(props as CloseProps, ['class']);
  return <DialogPrimitive.CloseButton data-icon-button="" class={cn('grid w-34 min-h-30 place-items-center rounded-7 border-0 bg-transparent text-22 font-300 text-text-muted cursor-pointer hover:bg-hover hover:text-text-primary pointer-coarse:w-48 pointer-coarse:min-h-44', local.class)} {...rest} />;
}

export function DialogPortal(props: DialogPrimitive.DialogPortalProps) {
  return <DialogPrimitive.Portal {...props} />;
}

type OverlayProps<T extends ValidComponent = 'div'> = DialogPrimitive.DialogOverlayProps<T> & { class?: string };
export function DialogOverlay<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, OverlayProps<T>>) {
  const [local, rest] = splitProps(props as OverlayProps, ['class']);
  return <DialogPrimitive.Overlay data-dialog-overlay class={cn('fixed inset-0 z-60 bg-scrim', local.class)} {...rest} />;
}

type DialogSize = 'default' | 'search' | 'settings' | 'mcp';

type ContentProps<T extends ValidComponent = 'div'> = DialogPrimitive.DialogContentProps<T> & {
  class?: string;
  children?: JSX.Element;
  dismissible?: boolean;
  overlayClass?: string;
  size?: DialogSize;
};
export function DialogContent<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ContentProps<T>>) {
  const [local, rest] = splitProps(props as ContentProps, ['class', 'children', 'dismissible', 'overlayClass', 'size']);
  const preventWhenLocked = (event: Event) => { if (local.dismissible === false) event.preventDefault(); };
  return <DialogPortal>
    <DialogOverlay class={local.overlayClass} />
    <DialogPrimitive.Content
      class={cn('fixed top-1/2 left-1/2 z-61 max-h-[calc(100dvh-2*var(--space-20))] w-[min(400px,calc(100vw-2*var(--space-20)))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-14 border border-border-strong bg-surface shadow-popover', {
        'w-(--container-search)': local.size === 'search',
        'w-(--container-settings) max-h-(--container-settings-tall)': local.size === 'settings',
        'w-(--container-mcp) max-h-(--container-settings-tall)': local.size === 'mcp',
      }, local.class)}
      onEscapeKeyDown={preventWhenLocked}
      onPointerDownOutside={preventWhenLocked}
      {...rest}
    >{local.children}</DialogPrimitive.Content>
  </DialogPortal>;
}

export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export const DialogHeader: Component<ComponentProps<'header'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <header class={cn('flex min-h-54 items-center gap-12 px-18 pr-10', local.class)} {...rest} />;
};

export const DialogFooter: Component<ComponentProps<'footer'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <footer class={cn('mt-10 flex justify-end gap-6', local.class)} {...rest} />;
};
