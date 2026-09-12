import { For, Show, splitProps } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Check, CircleAlert, CircleX, Info, LoaderCircle, X } from 'lucide-solid';
import { cn } from '../../lib/cn';
import { toastContentMotion } from '../../lib/overlay-motion';
import type { NoticeTone } from '../../lib/floating-notice-store';
import { notificationsForPlacement, notificationStore, type NotificationPlacement } from './notification-api';
import { IconButton } from '../Button';

const placementClasses: Record<NotificationPlacement, string> = {
  'top-left': 'top-16 left-16 items-start',
  'top-right': 'top-16 right-16 items-end',
  'bottom-left': 'bottom-16 left-16 items-start',
  'bottom-right': 'bottom-16 right-16 items-end',
};

const toneClasses: Record<NoticeTone, string> = {
  info: 'border-info-border',
  success: 'border-success-border',
  warning: 'border-warning-border',
  error: 'border-danger-border',
  loading: 'border-border-subtle',
};

function ToneIcon(props: { tone: NoticeTone }) {
  const size = 18;
  switch (props.tone) {
    case 'success':
      return <Check size={size} class="text-success" aria-hidden="true" />;
    case 'warning':
      return <CircleAlert size={size} class="text-warning" aria-hidden="true" />;
    case 'error':
      return <CircleX size={size} class="text-danger" aria-hidden="true" />;
    case 'loading':
      return <LoaderCircle size={size} class="animate-spin text-accent" aria-hidden="true" />;
    default:
      return <Info size={size} class="text-info" aria-hidden="true" />;
  }
}

type NotificationHostProps = {
  placement?: NotificationPlacement;
  class?: string;
};

/** 角落通知面板宿主，支持四角 placement。 */
export function NotificationHost(props: NotificationHostProps) {
  const [local] = splitProps(props, ['placement', 'class']);
  const placement = () => local.placement ?? 'top-right';
  const items = notificationsForPlacement(placement());

  return (
    <Portal>
      <div
        data-slot="notification-host"
        data-placement={placement()}
        class={cn(
          'pointer-events-none fixed z-90 flex w-(--container-toast) max-w-full flex-col gap-8',
          placementClasses[placement()],
          local.class,
        )}
        aria-live="polite"
      >
        <For each={items()}>
          {(item) => (
            <div
              role="status"
              data-tone={item.tone}
              class={cn(
                'pointer-events-auto flex w-full gap-10 rounded-12 border bg-surface px-16 py-12 text-13 text-text-primary shadow-popover',
                toastContentMotion,
                toneClasses[item.tone],
              )}
            >
              <ToneIcon tone={item.tone} />
              <div class="min-w-0 flex-1">
                <Show when={item.title}>
                  <div class="mb-4 text-14 font-semibold text-text-primary">{item.title}</div>
                </Show>
                <div class="text-13 text-text-secondary">{item.content}</div>
                <Show when={item.action}>
                  <div class="mt-8">{item.action}</div>
                </Show>
              </div>
              <IconButton
                label="Dismiss notification"
                size="sm"
                variant="ghost"
                showTooltip={false}
                class="size-24 shrink-0 self-start"
                onClick={() => notificationStore.dismiss(item.id)}
              >
                <X size={14} />
              </IconButton>
            </div>
          )}
        </For>
      </div>
    </Portal>
  );
}
