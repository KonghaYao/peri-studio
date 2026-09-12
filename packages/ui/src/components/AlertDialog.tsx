import type { Component, ComponentProps, JSX, ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as AlertDialogPrimitive from '@kobalte/core/alert-dialog';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';
import { modalDialogMotion, overlayScrimMotion } from '../lib/overlay-motion';
import { Button } from './Button';

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

type OverlayProps<T extends ValidComponent = 'div'> = AlertDialogPrimitive.AlertDialogOverlayProps<T> & { class?: string };
function AlertDialogOverlay<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, OverlayProps<T>>) {
  const [local, rest] = splitProps(props as OverlayProps, ['class']);
  return (
    <AlertDialogPrimitive.Overlay
      data-alert-dialog-overlay
      class={cn('fixed inset-0 z-60 bg-scrim', overlayScrimMotion, local.class)}
      {...rest}
    />
  );
}

type ContentProps<T extends ValidComponent = 'div'> = AlertDialogPrimitive.AlertDialogContentProps<T> & {
  class?: string;
  children?: JSX.Element;
  overlayClass?: string;
};
export function AlertDialogContent<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, ContentProps<T>>) {
  const [local, rest] = splitProps(props as ContentProps, ['class', 'children', 'overlayClass']);
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogOverlay class={local.overlayClass} />
      <AlertDialogPrimitive.Content
        class={cn(
          'fixed top-1/2 left-1/2 z-61 grid w-(--container-dialog-default) max-h-(--container-dialog-tall) -translate-x-1/2 -translate-y-1/2 gap-16 overflow-auto rounded-8 border border-border-subtle bg-surface px-20 py-20 text-text-primary shadow-popover outline-none',
          modalDialogMotion,
          local.class,
        )}
        {...rest}
      >
        {local.children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogTitle<T extends ValidComponent = 'h2'>(props: PolymorphicProps<T, AlertDialogPrimitive.AlertDialogTitleProps<T> & { class?: string }>) {
  const [local, rest] = splitProps(props as AlertDialogPrimitive.AlertDialogTitleProps & { class?: string }, ['class']);
  return (
    <AlertDialogPrimitive.Title
      class={cn('text-14 font-semibold leading-20 text-text-primary', local.class)}
      {...rest}
    />
  );
}

export function AlertDialogDescription<T extends ValidComponent = 'p'>(props: PolymorphicProps<T, AlertDialogPrimitive.AlertDialogDescriptionProps<T> & { class?: string }>) {
  const [local, rest] = splitProps(props as AlertDialogPrimitive.AlertDialogDescriptionProps & { class?: string }, ['class']);
  return (
    <AlertDialogPrimitive.Description
      class={cn('text-13 leading-20 text-content-muted', local.class)}
      {...rest}
    />
  );
}

export const AlertDialogHeader: Component<ComponentProps<'header'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <header class={cn('flex flex-col gap-8 text-left', local.class)} {...rest} />;
};

export const AlertDialogFooter: Component<ComponentProps<'footer'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <footer
      class={cn('flex flex-col-reverse gap-8 sm:flex-row sm:justify-end', local.class)}
      {...rest}
    />
  );
};

type ActionProps<T extends ValidComponent = 'button'> = AlertDialogPrimitive.AlertDialogCloseButtonProps<T> & {
  class?: string;
  children?: JSX.Element;
  variant?: 'primary' | 'danger';
  'aria-label'?: string;
};
export function AlertDialogAction<T extends ValidComponent = 'button'>(props: PolymorphicProps<T, ActionProps<T>>) {
  const [local, rest] = splitProps(props as ActionProps, ['class', 'children', 'variant', 'aria-label']);
  const label = local['aria-label'] ?? (typeof local.children === 'string' ? local.children : 'Confirm');
  return (
    <AlertDialogPrimitive.CloseButton
      as={Button}
      variant={local.variant ?? 'primary'}
      class={local.class}
      aria-label={label}
      {...rest}
    >
      {local.children}
    </AlertDialogPrimitive.CloseButton>
  );
}

type CancelProps<T extends ValidComponent = 'button'> = AlertDialogPrimitive.AlertDialogCloseButtonProps<T> & {
  class?: string;
  children?: JSX.Element;
  'aria-label'?: string;
};
export function AlertDialogCancel<T extends ValidComponent = 'button'>(props: PolymorphicProps<T, CancelProps<T>>) {
  const [local, rest] = splitProps(props as CancelProps, ['class', 'children', 'aria-label']);
  const label = local['aria-label'] ?? (typeof local.children === 'string' ? local.children : 'Cancel');
  return (
    <AlertDialogPrimitive.CloseButton
      as={Button}
      variant="default"
      class={local.class}
      aria-label={label}
      {...rest}
    >
      {local.children ?? 'Cancel'}
    </AlertDialogPrimitive.CloseButton>
  );
}
