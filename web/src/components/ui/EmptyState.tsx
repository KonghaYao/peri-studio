import { splitProps, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

type Props = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'> & {
  title: string;
  description: string;
  action?: JSX.Element;
  variant?: 'page' | 'inline';
};

const VARIANT_CLASS: Record<NonNullable<Props['variant']>, string> = {
  page: 'flex-1 px-32 py-48',
  inline: 'flex-[0_1_auto] rounded-12 border border-border-subtle bg-surface-muted p-24',
};

export function EmptyState(props: Props) {
  const [local, div] = splitProps(props, ['title', 'description', 'action', 'variant', 'class']);
  return (
    <div {...div} class={cn('flex min-h-0 flex-col items-center justify-center text-center', VARIANT_CLASS[local.variant ?? 'page'], local.class)}>
      <div class="mb-18 grid h-42 w-42 place-items-center rounded-12 border border-border-subtle bg-empty-mark-bg text-empty-mark-fg" aria-hidden="true">✦</div>
      <h2 class="text-24 font-650 tracking-[-.025em] text-text-primary">{local.title}</h2>
      <p class="mt-10 mb-18 max-w-[430px] text-14 leading-155 text-text-muted">{local.description}</p>
      {local.action}
    </div>
  );
}
