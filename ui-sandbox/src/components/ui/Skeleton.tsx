import { splitProps, type JSX } from 'solid-js';
import { cn } from '@/lib/cn';

type SkeletonProps = JSX.HTMLAttributes<HTMLDivElement>;

/** T2 占位：shadcn 式扫光条，装饰性，不含业务文案。 */
export function Skeleton(props: SkeletonProps) {
  const [local, rest] = splitProps(props, ['class']);
  return <div {...rest} class={cn('ui-skeleton', local.class)} />;
}
