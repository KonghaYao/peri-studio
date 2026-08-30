import { Dialog as KDialog } from '@kobalte/core/dialog';
import { X } from 'lucide-solid';
import { Show, type JSX } from 'solid-js';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';

/* AntD 方向模态：45% 遮罩、8px 圆角、overlay 阴影、右上关闭 */
export function Dialog(props: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  children: JSX.Element;
  footer?: JSX.Element;
  width?: string;
}) {
  return (
    <KDialog open={props.open} onOpenChange={props.onOpenChange}>
      <KDialog.Portal>
        <KDialog.Overlay class="fixed inset-0 z-(--z-modal) bg-scrim" />
        <div class="fixed inset-0 z-(--z-modal) grid place-items-center p-4">
          <KDialog.Content
            class={cn(
              'w-full rounded-lg bg-surface-overlay shadow-overlay outline-none',
              'max-w-(--container-auth-card)',
            )}
            style={props.width ? { 'max-width': props.width } : undefined}
          >
            <div class="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
              <KDialog.Title class="text-14 font-semibold text-content-primary">{props.title}</KDialog.Title>
              <KDialog.CloseButton as={IconButton} label="Close dialog" size="sm"><X size={15} /></KDialog.CloseButton>
            </div>
            <div class="px-5 py-4 text-13 leading-normal text-content-secondary">{props.children}</div>
            <Show when={props.footer}>
              <div class="flex justify-end gap-2 border-t border-border-subtle px-5 py-3">{props.footer}</div>
            </Show>
          </KDialog.Content>
        </div>
      </KDialog.Portal>
    </KDialog>
  );
}
