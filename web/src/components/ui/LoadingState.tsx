import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { Spinner } from './Spinner';

type LoadingStateProps = JSX.HTMLAttributes<HTMLDivElement> & {
  label: string;
  description?: JSX.Element;
};

/** Shared loading feedback with one polite live region and a decorative spinner. */
export function LoadingState(props: LoadingStateProps) {
  const [local, div] = splitProps(props, ['class', 'label', 'description', 'children']);
  return <div {...div} role="status" aria-live="polite" aria-label={local.label} class={cn('ui-loading-state', local.class)}>
    <Spinner decorative />
    <div class="ui-loading-state__copy">
      <strong class="ui-loading-state__label">{local.label}</strong>
      <Show when={local.description}><span class="ui-loading-state__description">{local.description}</span></Show>
      {local.children}
    </div>
  </div>;
}
