import { createUniqueId, Show, splitProps, type JSX } from 'solid-js';
import { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip';

type Props = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'compact' | 'default';
  busy?: boolean;
};

export function Button(props: Props) {
  const [local, button] = splitProps(props, ['variant', 'size', 'busy', 'class', 'children', 'disabled']);
  return (
    <button
      {...button}
      type={button.type ?? 'button'}
      disabled={local.disabled || local.busy}
      aria-busy={local.busy || undefined}
      class={`ui-button ui-button--${local.variant ?? 'ghost'} ui-button--${local.size ?? 'default'} ${local.class ?? ''}`}
    >
      <Show when={local.busy}><span class="ui-spinner" aria-hidden="true" /><span class="sr-only">Processing</span></Show>
      {local.children}
    </button>
  );
}

export function IconButton(props: Props & { label: string; tooltipPlacement?: 'start' | 'center' | 'end' }) {
  const [local, button] = splitProps(props, ['label', 'title', 'class', 'tooltipPlacement']);
  const helpId = `icon-help-${createUniqueId()}`;
  const customHelp = () => !!local.title && local.title !== local.label;
  return <Tooltip placement={local.tooltipPlacement === 'start' ? 'bottom-start' : local.tooltipPlacement === 'end' ? 'bottom-end' : 'bottom'}>
    <TooltipTrigger as="span" class="ui-tooltip-anchor">
      <Button {...button} aria-label={local.label} aria-description={customHelp() ? local.title : undefined} aria-describedby={customHelp() ? helpId : undefined} class={`ui-icon-button ${local.class ?? ''}`} />
    </TooltipTrigger>
    <TooltipContent id={customHelp() ? helpId : undefined}>{local.title ?? local.label}</TooltipContent>
  </Tooltip>;
}
