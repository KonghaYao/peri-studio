import { For, Show } from 'solid-js';
import { cn } from '@/lib/catalog-ui';
import { Box, SlidersHorizontal } from 'lucide-solid';

export type SlashKind = 'command' | 'skill' | 'mcp_skill';

export type SlashMenuItem = {
  name: string;
  description: string;
  kind?: SlashKind;
  accent?: boolean;
  variant?: 'default' | 'plan' | 'plugin';
  dividerAfter?: boolean;
};

function SlashIcon(props: { variant?: SlashMenuItem['variant']; accent?: boolean }) {
  if (props.variant === 'plan') {
    return <SlidersHorizontal size={15} strokeWidth={1.7} class={cn(props.accent ? 'text-warning-solid' : 'text-content-muted')} />;
  }
  return <Box size={15} strokeWidth={1.7} class="text-content-muted" />;
}

/** Composer slash 面板：图标 + 命令名 + 同行说明；分组分隔线。 */
export function SlashMenu(props: {
  items: SlashMenuItem[];
  activeIndex?: number;
}) {
  const active = () => props.activeIndex ?? 0;

  return (
    <div class="overflow-hidden rounded-xl border border-border-subtle bg-surface-overlay shadow-overlay">
      <ul class="max-h-240 overflow-auto py-6" role="listbox" aria-label="Slash commands">
        <For each={props.items}>
          {(item, index) => (
            <li class="list-none">
              <div
                role="option"
                aria-selected={index() === active()}
                class={cn(
                  'mx-6 cursor-pointer rounded-lg px-10 py-6 transition-colors duration-(--duration-fast)',
                  index() === active() ? 'bg-sidebar-selected' : 'hover:bg-interaction-hover',
                )}
              >
                <div class="flex min-w-0 items-center gap-10">
                  <span class="grid size-16 shrink-0 place-items-center">
                    <SlashIcon variant={item.variant} accent={item.accent} />
                  </span>
                  <p class="min-w-0 truncate text-13 leading-snug">
                    <span class={cn('font-medium', item.accent ? 'text-warning-strong' : 'text-content-primary')}>
                      {item.name}
                    </span>
                    <span class="text-content-muted"> {item.description}</span>
                  </p>
                </div>
              </div>
              <Show when={item.dividerAfter}>
                <div class="mx-12 my-4 border-t border-border-subtle" role="presentation" />
              </Show>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
