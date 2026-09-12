import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { Spinner } from './Spinner';

type LoadingStateProps = JSX.HTMLAttributes<HTMLDivElement> & {
  label: string;
  description?: JSX.Element;
  spinnerClass?: string;
};

/** Shared loading feedback with one polite live region and a decorative spinner. */
export function LoadingState(props: LoadingStateProps) {
  const [local, div] = splitProps(props, ['class', 'label', 'description', 'children', 'spinnerClass']);
  return (
    <div {...div} role="status" aria-live="polite" aria-label={local.label} class={cn('flex items-center gap-10 text-13 leading-normal text-text-secondary', local.class)}>
      <Spinner decorative class={local.spinnerClass} />
      <div class="flex min-w-0 flex-col gap-2">
        <strong class="font-medium text-text-primary">{local.label}</strong>
        <Show when={local.description}><span class="text-text-secondary">{local.description}</span></Show>
        {local.children}
      </div>
    </div>
  );
}
