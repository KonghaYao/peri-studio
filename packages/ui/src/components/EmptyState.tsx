import { splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';

type Props = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'> & {
  title: string;
  description?: string;
  icon?: JSX.Element;
  action?: JSX.Element;
  variant?: 'page' | 'inline';
};

const VARIANT_CLASS: Record<NonNullable<Props['variant']>, string> = {
  page: 'flex-1 px-32 py-48',
  inline: 'flex-initial rounded-8 border border-border-subtle bg-surface p-24',
};

export function EmptyState(props: Props) {
  const [local, div] = splitProps(props, ['title', 'description', 'icon', 'action', 'variant', 'class']);
  return (
    <div {...div} class={cn('flex min-h-0 flex-col items-center justify-center gap-8 py-48 text-center', VARIANT_CLASS[local.variant ?? 'page'], local.class)}>
      {local.icon && <div class="mb-4 text-text-faint" aria-hidden="true">{local.icon}</div>}
      <h2 class="text-13 font-medium text-text-primary">{local.title}</h2>
      {local.description && <p class="max-w-72 text-12 leading-normal text-text-muted">{local.description}</p>}
      {local.action && <div class="mt-12">{local.action}</div>}
    </div>
  );
}
