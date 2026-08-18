import type { Component, ComponentProps, JSX, ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as DialogPrimitive from '@kobalte/core/dialog';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../../lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.CloseButton;

export function DialogPortal(props: DialogPrimitive.DialogPortalProps) {
  return <DialogPrimitive.Portal {...props} />;
}

type OverlayProps<T extends ValidComponent = 'div'> = DialogPrimitive.DialogOverlayProps<T> & { class?: string };
export function DialogOverlay<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, OverlayProps<T>>) {
  const [local, rest] = splitProps(props as OverlayProps, ['class']);
  return <DialogPrimitive.Overlay class={cn('ui-dialog-backdrop', local.class)} {...rest} />;
}

type DialogSize = 'default' | 'search' | 'settings' | 'mcp' | 'rewind';

type ContentProps<T extends ValidComponent = 'div'> = DialogPrimitive.DialogContentProps<T> & {
  class?: string;
  children?: JSX.Element;
  dismissible?: boolean;
  size?: DialogSize;
};
export function DialogContent<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ContentProps<T>>) {
  const [local, rest] = splitProps(props as ContentProps, ['class', 'children', 'dismissible', 'size']);
  const preventWhenLocked = (event: Event) => { if (local.dismissible === false) event.preventDefault(); };
  return <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      class={cn('ui-dialog', `ui-dialog--${local.size ?? 'default'}`, local.class)}
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
  return <header class={cn('ui-dialog__header', local.class)} {...rest} />;
};

export const DialogFooter: Component<ComponentProps<'footer'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <footer class={cn('form-actions', local.class)} {...rest} />;
};
