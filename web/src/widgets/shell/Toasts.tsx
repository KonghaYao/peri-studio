// Store owns expiry; Kobalte owns live-region and visual behavior.
import { createEffect, onCleanup } from 'solid-js';
import { toasts } from '../../panel/store';
import { dismissToast, showToast, Toaster } from '@/shared/ui';

export function Toasts() {
  const rendered = new Map<number, number>();
  createEffect(() => {
    const current = new Set(toasts().map((toast) => toast.id));
    for (const toast of toasts()) {
      if (!rendered.has(toast.id)) rendered.set(toast.id, showToast(toast.msg));
    }
    for (const [id, toastId] of rendered) {
      if (!current.has(id)) {
        dismissToast(toastId);
        rendered.delete(id);
      }
    }
  });
  onCleanup(() => rendered.forEach(dismissToast));
  return <Toaster />;
}
