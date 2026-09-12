import { createSignal, Show, splitProps, type JSX } from 'solid-js';
import { CircleAlert } from 'lucide-solid';
import { cn } from '../../lib/cn';
import { Button } from '../Button';
import { Popover, PopoverContent, PopoverTrigger } from '../Popover';

export type PopconfirmProps = {
  title?: string | JSX.Element;
  description?: string | JSX.Element;
  okText?: string;
  cancelText?: string;
  okType?: 'primary' | 'danger' | 'default';
  disabled?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
  showArrow?: boolean;
  children: JSX.Element;
  class?: string;
};

/** 触发器上的确认气泡，对齐 Ant Design Popconfirm。 */
export function Popconfirm(props: PopconfirmProps) {
  const [local] = splitProps(props, [
    'title',
    'description',
    'okText',
    'cancelText',
    'okType',
    'disabled',
    'open',
    'defaultOpen',
    'onOpenChange',
    'onConfirm',
    'onCancel',
    'placement',
    'showArrow',
    'children',
    'class',
  ]);
  const [busy, setBusy] = createSignal(false);
  const [internalOpen, setInternalOpen] = createSignal(local.defaultOpen ?? false);
  const open = () => (local.open !== undefined ? local.open : internalOpen());
  const setOpen = (value: boolean) => {
    local.onOpenChange?.(value);
    if (local.open === undefined) setInternalOpen(value);
  };

  const handleConfirm = async () => {
    if (local.disabled) return;
    setBusy(true);
    try {
      await local.onConfirm?.();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    local.onCancel?.();
    setOpen(false);
  };

  return (
    <Popover open={open()} onOpenChange={setOpen} placement={local.placement ?? 'top'}>
      <PopoverTrigger as="span" class={cn('inline-flex', local.class, local.disabled && 'pointer-events-none opacity-45')}>
        {local.children}
      </PopoverTrigger>
      <PopoverContent class="w-(--container-popover) p-0">
        <div class="flex gap-10 px-16 py-12">
          <CircleAlert size={18} class="mt-2 shrink-0 text-warning" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <Show when={local.title}>
              <div class="text-14 font-semibold text-text-primary">{local.title}</div>
            </Show>
            <Show when={local.description}>
              <div class="mt-4 text-13 text-text-secondary">{local.description}</div>
            </Show>
          </div>
        </div>
        <div class="flex justify-end gap-8 border-t border-border-subtle px-16 py-10">
          <Button variant="default" size="sm" onClick={handleCancel}>
            {local.cancelText ?? 'Cancel'}
          </Button>
          <Button
            variant={local.okType === 'danger' ? 'danger' : 'primary'}
            size="sm"
            busy={busy()}
            onClick={handleConfirm}
          >
            {local.okText ?? 'OK'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
