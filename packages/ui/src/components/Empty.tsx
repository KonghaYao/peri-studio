import { cva, type VariantProps } from 'class-variance-authority';
import { Show, splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';
import { EMPTY_PRESETS, type EmptyPresetName } from './empty-presets';

type EmptyRootProps = ComponentProps<'div'> & {
  preset?: EmptyPresetName;
  image?: ComponentProps<'div'>['children'];
};

/** 空状态根容器：居中、虚线边框、token 间距。 */
export const Empty: Component<EmptyRootProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'preset', 'image', 'children']);
  const presetComponent = () => (local.preset ? EMPTY_PRESETS[local.preset] : undefined);
  return (
    <div
      data-slot="empty"
      class={cn(
        'flex min-w-0 flex-1 flex-col items-center justify-center gap-24 rounded-8 border border-dashed border-border-subtle p-24 text-center text-balance max-desk:p-48',
        local.class,
      )}
      {...rest}
    >
      <Show when={local.image}>
        <EmptyMedia variant="default">{local.image}</EmptyMedia>
      </Show>
      <Show when={!local.image && local.preset}>
        <EmptyMedia variant="default">
          {(() => {
            const Preset = presetComponent();
            return Preset ? <Preset /> : null;
          })()}
        </EmptyMedia>
      </Show>
      {local.children}
    </div>
  );
};

/** 空状态头部：图标/标题/描述的纵向堆叠。 */
export const EmptyHeader: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="empty-header"
      class={cn('flex w-full max-w-360 flex-col items-center gap-8 text-center', local.class)}
      {...rest}
    />
  );
};

const emptyMediaVariants = cva(
  'mb-8 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        icon: [
          'flex size-40 shrink-0 items-center justify-center rounded-8 bg-surface-muted text-content-primary',
          "[&_svg:not([class*='size-'])]:size-24",
        ],
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

type EmptyMediaProps = ComponentProps<'div'> & VariantProps<typeof emptyMediaVariants>;

/** 空状态媒体槽位（图标或插图）。 */
export const EmptyMedia: Component<EmptyMediaProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'variant']);
  const variant = () => local.variant ?? 'default';
  return (
    <div
      data-slot="empty-media"
      data-variant={variant()}
      class={cn(emptyMediaVariants({ variant: variant() }), local.class)}
      {...rest}
    />
  );
};

/** 空状态标题。 */
export const EmptyTitle: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="empty-title"
      class={cn('text-14 font-medium text-content-primary', local.class)}
      {...rest}
    />
  );
};

/** 空状态描述文案。 */
export const EmptyDescription: Component<ComponentProps<'p'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <p
      data-slot="empty-description"
      class={cn('text-12 text-content-muted', local.class)}
      {...rest}
    />
  );
};

/** 空状态附加内容区（如操作按钮）。 */
export const EmptyContent: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="empty-content"
      class={cn('flex flex-col items-center gap-8', local.class)}
      {...rest}
    />
  );
};
