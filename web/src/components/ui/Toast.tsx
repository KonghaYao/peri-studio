import { splitProps, type JSX, type ValidComponent } from 'solid-js';
import { Portal } from 'solid-js/web';
import * as ToastPrimitive from '@kobalte/core/toast';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../../lib/cn';

export function Toaster() {
  return <Portal><ToastPrimitive.Region><ToastPrimitive.List class="ui-toast-viewport" /></ToastPrimitive.Region></Portal>;
}

type ToastProps<T extends ValidComponent = 'li'> = ToastPrimitive.ToastRootProps<T> & { class?: string; children?: JSX.Element };
export function Toast<T extends ValidComponent = 'li'>(props: PolymorphicProps<T, ToastProps<T>>) {
  const [local, rest] = splitProps(props as ToastProps, ['class']);
  return <ToastPrimitive.Root class={cn('ui-toast is-visible', local.class)} {...rest} />;
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
