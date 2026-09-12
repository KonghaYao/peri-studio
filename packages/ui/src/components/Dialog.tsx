import type { Component, ComponentProps, JSX, ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as DialogPrimitive from '@kobalte/core/dialog';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';
import { modalDialogMotion, overlayScrimMotion } from '../lib/overlay-motion';
import { IconButton } from './Button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

type CloseProps<T extends ValidComponent = 'button'> = DialogPrimitive.DialogCloseButtonProps<T> & {
  class?: string;
  children?: JSX.Element;
  'aria-label'?: string;
};
export function DialogClose<T extends ValidComponent = 'button'>(props: PolymorphicProps<T, CloseProps<T>>) {
  const [local, rest] = splitProps(props as CloseProps, ['class', 'children', 'aria-label']);
  const label = local['aria-label'] ?? 'Close';
  return (
    <DialogPrimitive.CloseButton
      as={IconButton}
      label={label}
      variant="ghost"
      size="compact"
      showTooltip={false}
      class={cn('ml-auto shrink-0 text-22 font-300 text-text-muted hover:text-text-primary', local.class)}
      aria-label={label}
      {...rest}
    >
      {local.children ?? '×'}
    </DialogPrimitive.CloseButton>
  );
}

export function DialogPortal(props: DialogPrimitive.DialogPortalProps) {
  return <DialogPrimitive.Portal {...props} />;
}

type OverlayProps<T extends ValidComponent = 'div'> = DialogPrimitive.DialogOverlayProps<T> & { class?: string };
export function DialogOverlay<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, OverlayProps<T>>) {
  const [local, rest] = splitProps(props as OverlayProps, ['class']);
  return (
    <DialogPrimitive.Overlay
      data-dialog-overlay
      class={cn('fixed inset-0 z-60 bg-scrim', overlayScrimMotion, local.class)}
      {...rest}
    />
  );
}

type DialogSize = 'default' | 'search' | 'settings' | 'mcp' | 'resource-compact';

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
  const isSheet = () => local.size === 'resource-compact';
  return <DialogPortal>
    <DialogOverlay class={local.overlayClass} />
    <DialogPrimitive.Content
      class={cn(
        isSheet()
          ? cn(
              'fixed top-0 right-0 bottom-0 left-auto z-61 flex h-auto max-h-none w-(--container-rewind-compact) translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none border border-border-subtle border-y-0 border-r-0 bg-surface text-text-primary shadow-popover outline-none p-0',
              'ui-panel-sheet-motion slide-in-from-right motion-reduce:animate-none',
            )
          : 'fixed top-1/2 left-1/2 z-61 -translate-x-1/2 -translate-y-1/2 outline-none',
        !isSheet() && local.class,
      )}
      onEscapeKeyDown={preventWhenLocked}
      onPointerDownOutside={preventWhenLocked}
      {...rest}
    >
      {isSheet() ? local.children : (
        <div
          class={cn(
            'w-(--container-dialog-default) max-h-(--container-dialog-tall) overflow-auto rounded-8 border border-border-subtle bg-surface text-text-primary shadow-popover outline-none',
            modalDialogMotion,
            {
              'w-(--container-search)': local.size === 'search',
              'w-(--container-settings) max-h-(--container-settings-tall)': local.size === 'settings',
              'w-(--container-mcp) max-h-(--container-settings-tall)': local.size === 'mcp',
            },
            local.class,
          )}
        >
          {local.children}
        </div>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>;
}

type TitleProps<T extends ValidComponent = 'h2'> = DialogPrimitive.DialogTitleProps<T> & { class?: string };
export function DialogTitle<T extends ValidComponent = 'h2'>(props: PolymorphicProps<T, TitleProps<T>>) {
  const [local, rest] = splitProps(props as TitleProps, ['class']);
  return (
    <DialogPrimitive.Title
      class={cn('min-w-0 flex-1 text-14 font-semibold leading-20 text-text-primary', local.class)}
      {...rest}
    />
  );
}
export const DialogDescription = DialogPrimitive.Description;

export const DialogHeader: Component<ComponentProps<'header'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <header class={cn('flex min-h-0 items-center gap-8 border-b border-border-subtle px-20 py-14', local.class)} {...rest} />;
};

export const DialogFooter: Component<ComponentProps<'footer'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <footer class={cn('flex justify-end gap-8 border-t border-border-subtle px-20 py-12', local.class)} {...rest} />;
};
