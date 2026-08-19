import { splitProps, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

type Props = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'> & {
  title: string;
  description: string;
  action?: JSX.Element;
  variant?: 'page' | 'inline';
};

export function EmptyState(props: Props) {
  const [local, div] = splitProps(props, ['title', 'description', 'action', 'variant', 'class']);
  return (
    <div {...div} class={cn('ui-empty', `ui-empty--${local.variant ?? 'page'}`, local.class)}>
      <div class="ui-empty__mark" aria-hidden="true">✦</div>
      <h2>{local.title}</h2>
      <p>{local.description}</p>
      {local.action}
    </div>
  );
}
