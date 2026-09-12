import { createSignal, Show, splitProps, type Component, type ComponentProps, type JSX } from 'solid-js';
import { CheckCircle2, CircleAlert, CircleX, Info, X } from 'lucide-solid';
import { cn } from '../lib/cn';
import { IconButton } from './Button';

export type AlertType = 'info' | 'success' | 'warning' | 'error';
export type AlertVariant = AlertType | 'default' | 'destructive';

type AlertProps = ComponentProps<'div'> & {
  type?: AlertType;
  /** @deprecated 使用 type="error" */
  variant?: AlertVariant;
  banner?: boolean;
  closable?: boolean;
  showIcon?: boolean;
  onDismiss?: () => void;
  icon?: JSX.Element;
};

const typeClasses: Record<AlertType, string> = {
  info: 'border-info-border bg-info-soft text-text-primary',
  success: 'border-success-border bg-success-soft text-text-primary',
  warning: 'border-warning-border bg-warning-soft text-text-primary',
  error: 'border-danger-border bg-danger-soft text-text-primary',
};

function resolveAlertKind(props: AlertProps): AlertType | 'default' {
  if (props.type) return props.type;
  if (props.variant === 'destructive' || props.variant === 'error') return 'error';
  if (props.variant === 'success' || props.variant === 'warning' || props.variant === 'info') return props.variant;
  return 'default';
}

function resolveType(props: AlertProps): AlertType {
  const kind = resolveAlertKind(props);
  return kind === 'default' ? 'info' : kind;
}

function TypeIcon(props: { type: AlertType }) {
  const size = 18;
  switch (props.type) {
    case 'success':
      return <CheckCircle2 size={size} class="text-success" aria-hidden="true" />;
    case 'warning':
      return <CircleAlert size={size} class="text-warning" aria-hidden="true" />;
    case 'error':
      return <CircleX size={size} class="text-danger" aria-hidden="true" />;
    default:
      return <Info size={size} class="text-info" aria-hidden="true" />;
  }
}

export const Alert: Component<AlertProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'type',
    'variant',
    'banner',
    'closable',
    'showIcon',
    'onDismiss',
    'icon',
    'children',
  ]);
  const [closed, setClosed] = createSignal(false);
  const alertKind = () => resolveAlertKind(local);
  const alertType = () => resolveType(local);
  const role = () => {
    const kind = alertKind();
    if (kind === 'default') return undefined;
    if (kind === 'error') return 'alert';
    return 'status';
  };

  return (
    <Show when={!closed()}>
    <div
      data-slot="alert"
      data-type={alertType()}
      role={role()}
      class={cn(
        'relative flex w-full gap-10 border px-16 py-12',
        local.banner ? 'rounded-none border-x-0' : 'rounded-8',
        typeClasses[alertType()],
        local.class,
      )}
      {...rest}
    >
      <Show when={local.showIcon ?? true}>
        <div class="mt-1 shrink-0">{local.icon ?? <TypeIcon type={alertType()} />}</div>
      </Show>
      <div class="min-w-0 flex-1">{local.children}</div>
      <Show when={local.closable}>
        <IconButton
          label="Close alert"
          size="sm"
          variant="ghost"
          showTooltip={false}
          class="size-24 shrink-0 self-start"
          onClick={() => {
            setClosed(true);
            local.onDismiss?.();
          }}
        >
          <X size={14} />
        </IconButton>
      </Show>
    </div>
    </Show>
  );
};

export const AlertTitle: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="alert-title"
      class={cn('mb-4 text-14 font-semibold leading-none tracking-tight', local.class)}
      {...rest}
    />
  );
};

export const AlertDescription: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="alert-description"
      class={cn('text-13 leading-normal text-text-secondary', local.class)}
      {...rest}
    />
  );
};
