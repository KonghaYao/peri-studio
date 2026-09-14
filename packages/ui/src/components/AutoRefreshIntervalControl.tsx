import { Check, RefreshCw } from 'lucide-solid';
import { For, Show, splitProps, type Component } from 'solid-js';
import { cn } from '../lib/cn';
import { Button } from './Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

const DEFAULT_LABELS: Record<number, string> = {
  0: 'Off',
  15000: '15s',
  30000: '30s',
  60000: '1m',
};

export type AutoRefreshIntervalControlProps = {
  value: number;
  options: number[];
  onChange: (intervalMs: number) => void;
  labels?: Record<number, string>;
  /** 未传时：value > 0 视为 spinning。 */
  spinning?: boolean;
  menuLabel?: string;
  title?: string;
  class?: string;
  'data-testid'?: string;
};

/**
 * T3 · 自动刷新间隔选择：ghost 按钮 + 下拉 cadence。
 * 对应 peri-fuse `auto-refresh-control.tsx`；interval 由 T4 注入，不绑 store。
 */
export const AutoRefreshIntervalControl: Component<AutoRefreshIntervalControlProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'value',
    'options',
    'onChange',
    'labels',
    'spinning',
    'menuLabel',
    'title',
    'class',
  ]);

  const labelFor = (ms: number) => local.labels?.[ms] ?? DEFAULT_LABELS[ms] ?? String(ms);
  const active = () => local.value > 0;
  const showSpin = () => local.spinning ?? active();

  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger
        as={Button}
        variant="ghost"
        size="sm"
        class={cn(
          'h-28 shrink-0 gap-6 text-content-secondary',
          active() && 'text-accent-solid',
          local.class,
        )}
        title={local.title ?? 'Auto-refresh interval'}
        aria-label={local.title ?? 'Auto-refresh interval'}
        {...rest}
      >
        <RefreshCw
          size={14}
          aria-hidden="true"
          class={cn(showSpin() && 'animate-spin')}
        />
        <span class="text-12">{labelFor(local.value)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-(--container-menu-min)" aria-label={local.menuLabel ?? 'Auto-refresh'}>
        <DropdownMenuLabel class="text-12 font-medium text-content-muted">
          {local.menuLabel ?? 'Auto-refresh'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <For each={local.options}>
          {(ms) => (
            <DropdownMenuItem class="text-12" onSelect={() => local.onChange(ms)}>
              <span>{labelFor(ms)}</span>
              <Show when={local.value === ms}>
                <Check class="ml-auto size-14 text-accent-solid" aria-hidden="true" />
              </Show>
            </DropdownMenuItem>
          )}
        </For>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
