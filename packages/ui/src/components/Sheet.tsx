import type { Component, ComponentProps, JSX, ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as DialogPrimitive from '@kobalte/core/dialog';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';
import { IconButton } from './Button';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;

type SheetSide = 'top' | 'right' | 'bottom' | 'left';

const sheetSideClasses: Record<SheetSide, string> = {
  top: 'inset-x-0 top-0 max-h-(--container-dialog-tall) border-b data-[expanded]:slide-in-from-top data-[closed]:slide-out-to-top',
  right: 'inset-y-0 right-0 h-full w-(--container-drawer) border-l data-[expanded]:slide-in-from-right data-[closed]:slide-out-to-right',
  bottom: 'inset-x-0 bottom-0 max-h-(--container-dialog-tall) border-t data-[expanded]:slide-in-from-bottom data-[closed]:slide-out-to-bottom',
  left: 'inset-y-0 left-0 h-full w-(--container-drawer) border-r data-[expanded]:slide-in-from-left data-[closed]:slide-out-to-left',
};

type OverlayProps<T extends ValidComponent = 'div'> = DialogPrimitive.DialogOverlayProps<T> & { class?: string };
function SheetOverlay<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, OverlayProps<T>>) {
  const [local, rest] = splitProps(props as OverlayProps, ['class']);
  return (
    <DialogPrimitive.Overlay
      data-sheet-overlay
      class={cn('fixed inset-0 z-60 bg-scrim', local.class)}
      {...rest}
    />
  );
}

type ContentProps<T extends ValidComponent = 'div'> = DialogPrimitive.DialogContentProps<T> & {
  class?: string;
  children?: JSX.Element;
  side?: SheetSide;
  overlayClass?: string;
};
export function SheetContent<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ContentProps<T>>) {
  const [local, rest] = splitProps(props as ContentProps, ['class', 'children', 'side', 'overlayClass']);
  const side = () => local.side ?? 'right';
  return (
    <DialogPrimitive.Portal>
      <SheetOverlay class={local.overlayClass} />
      <DialogPrimitive.Content
        class={cn(
          'fixed z-61 flex flex-col overflow-hidden rounded-none border border-border-subtle bg-surface text-text-primary shadow-popover outline-none transition ease-in-out data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:duration-300 data-[expanded]:duration-500 motion-reduce:transition-none motion-reduce:animate-none',
          sheetSideClasses[side()],
          local.class,
        )}
        {...rest}
      >
        {local.children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetTitle<T extends ValidComponent = 'h2'>(props: PolymorphicProps<T, DialogPrimitive.DialogTitleProps<T> & { class?: string }>) {
  const [local, rest] = splitProps(props as DialogPrimitive.DialogTitleProps & { class?: string }, ['class']);
  return (
    <DialogPrimitive.Title
      class={cn('text-14 font-semibold leading-20 text-text-primary', local.class)}
      {...rest}
    />
  );
}

export function SheetDescription<T extends ValidComponent = 'p'>(props: PolymorphicProps<T, DialogPrimitive.DialogDescriptionProps<T> & { class?: string }>) {
  const [local, rest] = splitProps(props as DialogPrimitive.DialogDescriptionProps & { class?: string }, ['class']);
  return (
    <DialogPrimitive.Description
      class={cn('text-13 leading-20 text-content-muted', local.class)}
      {...rest}
    />
  );
}

export const SheetHeader: Component<ComponentProps<'header'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <header class={cn('flex flex-col gap-8 px-20 py-16', local.class)} {...rest} />;
};

export const SheetFooter: Component<ComponentProps<'footer'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <footer
      class={cn('flex flex-col-reverse gap-8 border-t border-border-subtle px-20 py-12 sm:flex-row sm:justify-end', local.class)}
      {...rest}
    />
  );
};

type CloseProps<T extends ValidComponent = 'button'> = DialogPrimitive.DialogCloseButtonProps<T> & {
  class?: string;
  children?: JSX.Element;
  'aria-label'?: string;
};
export function SheetClose<T extends ValidComponent = 'button'>(props: PolymorphicProps<T, CloseProps<T>>) {
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
