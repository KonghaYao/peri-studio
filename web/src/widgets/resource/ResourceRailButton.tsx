import { Show, type JSX } from 'solid-js';
import { IconButton } from '@peri/ui';

type ResourceRailButtonProps = {
  label: string;
  active?: boolean;
  badge?: number;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  onClick: () => void;
  children: JSX.Element;
};

/** Shared rectangular action used by the workspace resource rail. */
export function ResourceRailButton(props: ResourceRailButtonProps) {
  return <IconButton
    label={props.label}
    showTooltip={false}
    aria-pressed={props.active}
    disabled={props.disabled}
    onClick={props.onClick}
    class={`relative w-40 min-h-34 rounded-md border-0 bg-transparent hover:bg-interaction-hover focus-visible:outline-offset-1 pointer-coarse:w-48 pointer-coarse:min-h-44 ${props.tone === 'danger' ? 'text-danger hover:text-danger' : 'text-content-muted hover:text-content-primary'} ${props.active ? 'bg-sidebar-selected text-content-primary before:absolute before:top-6 before:bottom-6 before:-left-3 before:w-2 before:rounded-2 before:bg-accent-solid' : ''}`}
  >
    {props.children}
    <Show when={(props.badge ?? 0) > 0}><span class="absolute right-2 bottom-2 min-w-14 rounded-6 bg-accent-solid px-4 text-center text-9 leading-14 text-content-on-accent">{props.badge! > 99 ? '99+' : props.badge}</span></Show>
  </IconButton>;
}
