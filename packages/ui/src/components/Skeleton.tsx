import { splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';

type SkeletonProps = JSX.HTMLAttributes<HTMLDivElement>;

/** Shared shimmer placeholder (shadcn-style). Decorative; pair with a live region. */
export function Skeleton(props: SkeletonProps) {
  const [local, rest] = splitProps(props, ['class']);
  return <div {...rest} class={cn('ui-skeleton', local.class)} />;
}
