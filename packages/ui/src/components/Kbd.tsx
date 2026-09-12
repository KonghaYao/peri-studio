import { splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';

export function Kbd(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <kbd
      {...rest}
      class={cn(
        'inline-flex rounded-4 border border-border-subtle bg-surface-muted px-6 py-2',
        'font-mono text-10 text-content-secondary',
        local.class,
      )}
    />
  );
}
