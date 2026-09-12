import { splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';

export function Label(props: JSX.LabelHTMLAttributes<HTMLLabelElement> & { class?: string }) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <label
      class={cn(
        'text-12 font-semibold text-text-secondary',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        local.class,
      )}
      {...rest}
    />
  );
}
