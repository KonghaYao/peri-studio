import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '@/shared/lib/cn';
import { MoreHorizontal, Pin } from 'lucide-solid';

export function SectionHeader(props: { title: string; icon?: JSX.Element; children?: JSX.Element }) {
  return (
    <div class="flex items-center gap-1 px-2.5 pb-1 pt-3">
      <span class="flex min-w-0 flex-1 items-center gap-1.5 text-12 text-content-muted">
        <Show when={props.icon}>
          <span class="grid size-4 shrink-0 place-items-center text-content-faint">{props.icon}</span>
        </Show>
        {props.title}
      </span>
      {props.children}
    </div>
  );
}

export function NavAction(props: { icon: JSX.Element; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      class="flex w-full min-h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-13 text-content-primary transition-colors duration-(--duration-fast) hover:bg-interaction-hover disabled:cursor-not-allowed disabled:opacity-50"
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <span class="grid size-4 shrink-0 place-items-center text-content-muted">{props.icon}</span>
      {props.label}
    </button>
  );
}

export function SessionRowTail(props: {
  time: string;
  live?: boolean;
  liveLabel?: string;
  menu?: JSX.Element;
  pinOnHover?: boolean;
}) {
  const hoverAction = () => props.pinOnHover;
  return (
    <span class="relative flex h-6 w-12 shrink-0 items-center justify-end">
      <span
        class={cn(
          'flex items-center gap-1.5 tabular-nums text-11 text-content-muted transition-opacity duration-(--duration-fast)',
          hoverAction() && 'group-hover/row:opacity-0 group-focus-within/row:opacity-0',
        )}
      >
        <Show when={props.live}>
          <span class="session-loading-wave relative flex size-1.5" role="status" aria-label={props.liveLabel}>
            <span class="session-loading-wave__halo absolute inline-flex size-full animate-ping rounded-full bg-success-solid opacity-30 motion-reduce:animate-none" aria-hidden="true" />
            <span class="session-loading-wave__core relative inline-flex size-1.5 rounded-full bg-success-solid" aria-hidden="true" />
          </span>
        </Show>
        <span aria-hidden="true">{props.time}</span>
      </span>
      <Show when={props.pinOnHover}>
        <span
          class="absolute right-0 grid size-6 place-items-center text-content-muted opacity-0 transition-opacity duration-(--duration-fast) group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100"
          aria-hidden="true"
        >
          <Pin size={14} strokeWidth={1.7} />
        </span>
      </Show>
    </span>
  );
}

export function SessionMenuIcon() {
  return <MoreHorizontal size={14} strokeWidth={1.7} />;
}
