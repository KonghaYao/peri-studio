import type { Component, JSX, ValidComponent } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import * as PopoverPrimitive from '@kobalte/core/popover';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { FloatingSurface } from './FloatingSurface';
import { cn } from '../lib/cn';
import { floatingPositionedShellClass, surfacePopoverMotion } from '../lib/overlay-motion';

const Popover: Component<PopoverPrimitive.PopoverRootProps> = (props) => <PopoverPrimitive.Root gutter={4} {...props} />;
const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = <T extends ValidComponent = 'div'>(props: PolymorphicProps<T, PopoverPrimitive.PopoverContentProps<T> & { class?: string; children?: JSX.Element; showArrow?: boolean }>) => {
  const [local, others] = splitProps(props as PopoverPrimitive.PopoverContentProps & { class?: string; children?: JSX.Element; showArrow?: boolean }, ['class', 'children', 'showArrow']);
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content class={floatingPositionedShellClass} {...others}>
        <FloatingSurface
          class={cn(
            'box-border w-(--container-popover) min-w-(--container-menu-min) origin-[var(--kb-popover-content-transform-origin)] rounded-8 border border-border-subtle bg-surface px-16 py-12 text-13 leading-normal text-text-primary shadow-popover outline-none focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2',
            surfacePopoverMotion,
            local.class,
          )}
        >
          {local.children}
        </FloatingSurface>
        <Show when={local.showArrow ?? true}>
          <PopoverPrimitive.Arrow class="fill-surface stroke-border-subtle" />
        </Show>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
};

export { Popover, PopoverContent, PopoverTrigger };
