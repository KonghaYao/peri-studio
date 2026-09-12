import { For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Check, CircleAlert, CircleX, Info, LoaderCircle, X } from 'lucide-solid';
import { cn } from '../../lib/cn';
import { toastContentMotion } from '../../lib/overlay-motion';
import type { NoticeTone } from '../../lib/floating-notice-store';
import { messageStore } from './message-api';
import { IconButton } from '../Button';

const toneClasses: Record<NoticeTone, string> = {
  info: 'border-info-border bg-surface text-text-primary',
  success: 'border-success-border bg-surface text-text-primary',
  warning: 'border-warning-border bg-surface text-text-primary',
  error: 'border-danger-border bg-surface text-text-primary',
  loading: 'border-border-subtle bg-surface text-text-primary',
};

function ToneIcon(props: { tone: NoticeTone }) {
  const size = 16;
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

/** 顶部轻量消息栈宿主；与 Toast 分离，对齐 Ant Design Message。 */
export function MessageHost() {
  return (
    <Portal>
      <div
        data-slot="message-host"
        class="pointer-events-none fixed top-16 left-1/2 z-90 flex w-full max-w-(--container-dialog-default) -translate-x-1/2 flex-col items-center gap-8 px-16"
        aria-live="polite"
      >
        <For each={messageStore.items()}>
          {(item) => (
            <div
              role="status"
              data-tone={item.tone}
              class={cn(
                'pointer-events-auto flex w-max max-w-full items-center gap-8 rounded-8 border px-16 py-10 text-13 shadow-popover',
                toastContentMotion,
                toneClasses[item.tone],
              )}
            >
              <ToneIcon tone={item.tone} />
              <div class="min-w-0">{item.content}</div>
              <Show when={item.duration === 0}>
                <IconButton
                  label="Dismiss message"
                  size="sm"
                  variant="ghost"
                  showTooltip={false}
                  class="size-24 shrink-0"
                  onClick={() => messageStore.dismiss(item.id)}
                >
                  <X size={14} />
                </IconButton>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Portal>
  );
}
