import { splitProps, type JSX, type ValidComponent } from 'solid-js';
import { Portal } from 'solid-js/web';
import * as ToastPrimitive from '@kobalte/core/toast';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';
import { toastContentMotion } from '../lib/overlay-motion';

export function Toaster() {
  return <Portal><ToastPrimitive.Region><ToastPrimitive.List class="fixed top-16 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-6 pointer-events-none sm:top-auto sm:right-24 sm:bottom-24 sm:left-auto sm:translate-x-0 sm:items-end" /></ToastPrimitive.Region></Portal>;
}

type ToastProps<T extends ValidComponent = 'li'> = ToastPrimitive.ToastRootProps<T> & { class?: string; children?: JSX.Element };
export function Toast<T extends ValidComponent = 'li'>(props: PolymorphicProps<T, ToastProps<T>>) {
  const [local, rest] = splitProps(props as ToastProps, ['class']);
  return (
    <ToastPrimitive.Root
      class={cn(
        'box-border w-(--container-toast) rounded-12 border border-border-subtle bg-surface px-12 py-9 text-13 leading-14 text-text-primary shadow-popover pointer-events-auto',
        toastContentMotion,
        local.class,
      )}
      {...rest}
    />
  );
}

export const ToastTitle = ToastPrimitive.Title;
export const ToastDescription = ToastPrimitive.Description;
export const ToastClose = ToastPrimitive.CloseButton;

export function showToast(content: JSX.Element, duration?: number) {
  return ToastPrimitive.toaster.show((data) => <Toast toastId={data.toastId} duration={duration}>{content}</Toast>);
}

export function dismissToast(id: number) {
  ToastPrimitive.toaster.dismiss(id);
}
