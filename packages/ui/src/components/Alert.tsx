import { splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';

export type AlertVariant = 'default' | 'destructive';

type AlertProps = ComponentProps<'div'> & {
  variant?: AlertVariant;
};

const variantClasses: Record<AlertVariant, string> = {
  default: 'border-info-border bg-info-soft text-text-primary',
  destructive: 'border-danger-border bg-danger-soft text-text-primary',
};

export const Alert: Component<AlertProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'variant']);
  const variant = () => local.variant ?? 'default';
  return (
    <div
      data-slot="alert"
      role={variant() === 'destructive' ? 'alert' : undefined}
      class={cn(
        'relative w-full rounded-8 border px-16 py-12',
        variantClasses[variant()],
        local.class,
      )}
      {...rest}
    />
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
