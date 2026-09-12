import { cva, type VariantProps } from 'class-variance-authority';
import { splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';

const skeletonVariants = cva('ui-skeleton', {
  variants: {
    active: {
      true: '',
      false: 'ui-skeleton-static',
    },
  },
  defaultVariants: {
    active: true,
  },
});

type SkeletonProps = ComponentProps<'div'> & VariantProps<typeof skeletonVariants>;

/** Shared shimmer placeholder (shadcn-style). Decorative; pair with a live region. */
export function Skeleton(props: SkeletonProps) {
  const [local, rest] = splitProps(props, ['class', 'active']);
  return (
    <div
      {...rest}
      class={cn(skeletonVariants({ active: local.active ?? true }), local.class)}
    />
  );
}

export const SkeletonAvatar: Component<{ class?: string; active?: boolean }> = (props) => (
  <Skeleton active={props.active} class={cn('size-36 rounded-full', props.class)} />
);

export const SkeletonButton: Component<{ class?: string; active?: boolean }> = (props) => (
  <Skeleton active={props.active} class={cn('h-32 w-80 rounded-6', props.class)} />
);

export const SkeletonInput: Component<{ class?: string; active?: boolean }> = (props) => (
  <Skeleton active={props.active} class={cn('h-36 w-full rounded-6', props.class)} />
);

export type SkeletonParagraphProps = {
  rows?: number;
  active?: boolean;
  class?: string;
};

export const SkeletonParagraph: Component<SkeletonParagraphProps> = (props) => {
  const rows = () => props.rows ?? 3;
  const widths = ['w-full', 'w-280', 'w-240', 'w-200'];
  return (
    <div class={cn('flex flex-col gap-8', props.class)}>
      {Array.from({ length: rows() }, (_, index) => (
        <Skeleton
          active={props.active}
          class={cn('h-12', widths[index % widths.length])}
        />
      ))}
    </div>
  );
};
