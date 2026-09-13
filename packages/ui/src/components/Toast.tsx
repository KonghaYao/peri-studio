import { splitProps, type JSX, type ValidComponent } from 'solid-js';
import { Portal } from 'solid-js/web';
import * as ToastPrimitive from '@kobalte/core/toast';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';
import { toastContentMotion } from '../lib/overlay-motion';
import { Button } from './Button';

export type ToastPlacement =
  | 'top'
  | 'top-left'
  | 'top-right'
  | 'bottom'
  | 'bottom-left'
  | 'bottom-right';

const placementClasses: Record<ToastPlacement, string> = {
  top: 'top-16 left-1/2 -translate-x-1/2 items-center',
  'top-left': 'top-16 left-16 items-start',
  'top-right': 'top-16 right-16 items-end',
  bottom: 'bottom-16 left-1/2 -translate-x-1/2 items-center',
  'bottom-left': 'bottom-16 left-16 items-start',
  'bottom-right': 'bottom-16 right-16 items-end',
};

type ToasterProps = {
  placement?: ToastPlacement;
  class?: string;
};

export function Toaster(props: ToasterProps = {}) {
  const [local] = splitProps(props, ['placement', 'class']);
  const placement = () => local.placement ?? 'top-right';
  return (
    <Portal>
      <ToastPrimitive.Region>
        <ToastPrimitive.List
          class={cn(
            'fixed z-50 flex flex-col gap-6 pointer-events-none p-safe',
            placementClasses[placement()],
            local.class,
          )}
        />
      </ToastPrimitive.Region>
    </Portal>
  );
}

type ToastProps<T extends ValidComponent = 'li'> = ToastPrimitive.ToastRootProps<T> & {
  class?: string;
  children?: JSX.Element;
  action?: JSX.Element;
};
export function Toast<T extends ValidComponent = 'li'>(props: PolymorphicProps<T, ToastProps<T>>) {
  const [local, rest] = splitProps(props as ToastProps, ['class', 'action', 'children']);
  return (
    <ToastPrimitive.Root
      class={cn(
        'box-border w-(--container-toast) rounded-12 border border-border-subtle bg-surface px-12 py-9 text-13 leading-14 text-text-primary shadow-popover pointer-events-auto',
        toastContentMotion,
        local.class,
      )}
      {...rest}
    >
      <div class="flex items-start justify-between gap-10">
        <div class="min-w-0 flex-1">{local.children}</div>
        {local.action}
      </div>
    </ToastPrimitive.Root>
  );
}

export const ToastTitle = ToastPrimitive.Title;
export const ToastDescription = ToastPrimitive.Description;
export const ToastClose = ToastPrimitive.CloseButton;

export type ToastShowOptions = {
  duration?: number;
  action?: JSX.Element;
};

export function showToast(content: JSX.Element, options?: ToastShowOptions | number) {
  const normalized = typeof options === 'number' ? { duration: options } : options;
  return ToastPrimitive.toaster.show((data) => (
    <Toast toastId={data.toastId} duration={normalized?.duration} action={normalized?.action}>
      {content}
    </Toast>
  ));
}

export function showToastAction(label: string, onClick: () => void, content: JSX.Element, duration?: number) {
  return showToast(content, {
    duration,
    action: <Button variant="ghost" size="sm" onClick={onClick}>{label}</Button>,
  });
}

export function showToastPromise<T>(
  promise: Promise<T>,
  messages: { loading: JSX.Element; success: JSX.Element; error: JSX.Element },
) {
  const loadingId = showToast(messages.loading, { duration: 0 });
  return promise
    .then((result) => {
      dismissToast(loadingId);
      showToast(messages.success);
      return result;
    })
    .catch((error) => {
      dismissToast(loadingId);
      showToast(messages.error);
      throw error;
    });
}

export function dismissToast(id: number) {
  ToastPrimitive.toaster.dismiss(id);
}
