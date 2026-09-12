import type { Component, ComponentProps } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../lib/cn';

export const Card: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="card"
      class={cn('rounded-8 border border-border-subtle bg-surface shadow-none', local.class)}
      {...rest}
    />
  );
};

export const CardHeader: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="card-header"
      class={cn('flex flex-col gap-4 px-16 py-12', local.class)}
      {...rest}
    />
  );
};

export const CardTitle: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="card-title"
      class={cn('text-14 font-semibold text-text-primary', local.class)}
      {...rest}
    />
  );
};

export const CardDescription: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="card-description"
      class={cn('text-12 text-content-muted', local.class)}
      {...rest}
    />
  );
};

export const CardContent: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="card-content"
      class={cn('px-16 py-12', local.class)}
      {...rest}
    />
  );
};

export const CardFooter: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="card-footer"
      class={cn('flex items-center px-16 py-12', local.class)}
      {...rest}
    />
  );
};
