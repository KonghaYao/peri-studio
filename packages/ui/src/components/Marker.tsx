import { cva, type VariantProps } from 'class-variance-authority';
import {
  createContext,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
} from 'solid-js';
import { cn } from '../lib/cn';

export type MarkerVariant = 'default' | 'border' | 'separator';

export const markerVariants = cva('flex min-w-0 text-12 text-content-muted', {
  variants: {
    variant: {
      default: 'w-full items-center gap-8',
      border: 'w-full items-center gap-8 border-b border-border-subtle pb-8',
      separator:
        'w-full items-center gap-8 before:h-px before:flex-1 before:shrink before:bg-divider after:h-px after:flex-1 after:shrink after:bg-divider',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

type MarkerContextValue = {
  variant: () => MarkerVariant;
};

const MarkerContext = createContext<MarkerContextValue>();

function useMarkerContext(component: string): MarkerContextValue {
  const context = useContext(MarkerContext);
  if (!context) {
    throw new Error(`${component} must be used within Marker`);
  }
  return context;
}

type MarkerProps = ComponentProps<'div'> & VariantProps<typeof markerVariants>;

/** 会话内联标记：状态、系统说明或分隔标签。 */
export const Marker: Component<MarkerProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'variant']);
  const variant = () => local.variant ?? 'default';
  return (
    <MarkerContext.Provider value={{ variant }}>
      <div
        data-slot="marker"
        data-variant={variant()}
        class={cn(markerVariants({ variant: variant() }), local.class)}
        {...rest}
      />
    </MarkerContext.Provider>
  );
};

/** 标记图标槽位（装饰性，对辅助技术隐藏）。 */
export const MarkerIcon: Component<ComponentProps<'span'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  useMarkerContext('MarkerIcon');
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      class={cn(
        'inline-flex shrink-0 items-center text-content-muted [&_svg:not([class*="size-"])]:size-14',
        local.class,
      )}
      {...rest}
    />
  );
};

/** 标记正文。 */
export const MarkerContent: Component<ComponentProps<'span'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  useMarkerContext('MarkerContent');
  return (
    <span
      data-slot="marker-content"
      class={cn('min-w-0 shrink-0 leading-normal', local.class)}
      {...rest}
    />
  );
};

/** 带左右分割线的居中标签分隔符（等价于 `variant="separator"`）。 */
export const MarkerSeparator: Component<Omit<MarkerProps, 'variant'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <Marker variant="separator" class={local.class} {...rest} />;
};
