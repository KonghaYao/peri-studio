import { cva, type VariantProps } from 'class-variance-authority';
import { splitProps, type Component, type ComponentProps, type ValidComponent } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../lib/cn';
import { resolveLayoutGap, type LayoutGapSize } from '../lib/layout-gap';

const flexVariants = cva('flex', {
  variants: {
    vertical: {
      true: 'flex-col',
      false: 'flex-row',
    },
    wrap: {
      true: 'flex-wrap',
      false: 'flex-nowrap',
      wrap: 'flex-wrap',
      nowrap: 'flex-nowrap',
      reverse: 'flex-wrap-reverse',
    },
    justify: {
      start: 'justify-start',
      end: 'justify-end',
      center: 'justify-center',
      'space-between': 'justify-between',
      'space-around': 'justify-around',
      'space-evenly': 'justify-evenly',
      stretch: 'justify-stretch',
    },
    align: {
      start: 'items-start',
      end: 'items-end',
      center: 'items-center',
      baseline: 'items-baseline',
      stretch: 'items-stretch',
    },
  },
  defaultVariants: {
    vertical: false,
    wrap: false,
    justify: 'start',
    align: 'stretch',
  },
});

type FlexVariantProps = VariantProps<typeof flexVariants>;

type FlexProps<T extends ValidComponent = 'div'> = ComponentProps<T> &
  FlexVariantProps & {
    component?: T;
    gap?: LayoutGapSize;
    /** @deprecated 使用 vertical */
    orientation?: 'horizontal' | 'vertical';
    flex?: string | number;
  };

function resolveWrap(wrap?: FlexVariantProps['wrap'] | boolean): FlexVariantProps['wrap'] {
  if (wrap === true) return 'wrap';
  if (wrap === false) return 'nowrap';
  return wrap;
}

export const Flex: Component<FlexProps> = (props) => {
  const [local, variants, rest] = splitProps(
    props,
    ['class', 'children', 'component', 'gap', 'orientation', 'flex', 'style', 'vertical', 'wrap'],
    ['justify', 'align'],
  );

  const isVertical = () =>
    local.vertical ?? (local.orientation === 'vertical' ? true : local.orientation === 'horizontal' ? false : undefined);

  const gapStyle = () => {
    const gap = resolveLayoutGap(local.gap);
    if (!gap) return undefined;
    return { gap };
  };

  const flexStyle = () => {
    const base = typeof local.style === 'object' && local.style !== null ? { ...local.style } : {};
    const gap = gapStyle();
    if (gap) Object.assign(base, gap);
    if (local.flex !== undefined) {
      base.flex = typeof local.flex === 'number' ? `${local.flex} ${local.flex} auto` : local.flex;
    }
    return Object.keys(base).length > 0 ? base : local.style;
  };

  return (
    <Dynamic
      component={local.component ?? 'div'}
      data-slot="flex"
      class={cn(
        flexVariants({
          vertical: isVertical(),
          wrap: resolveWrap(local.wrap),
          justify: variants.justify,
          align: variants.align,
        }),
        local.class,
      )}
      style={flexStyle()}
      {...rest}
    >
      {local.children}
    </Dynamic>
  );
};
