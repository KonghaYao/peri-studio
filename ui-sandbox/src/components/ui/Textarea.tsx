import { splitProps, type JSX } from 'solid-js';
import { cn } from '@/lib/cn';

export function Textarea(props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  const [local, rest] = splitProps(props, ['class', 'invalid']);
  return (
    <textarea
      aria-invalid={local.invalid || undefined}
      class={cn(
        'w-full resize-none rounded-md border bg-surface-overlay px-3 py-2 text-13 leading-normal text-content-primary outline-none transition-colors duration-(--duration-fast)',
        'placeholder:text-content-faint',
        local.invalid
          ? 'border-danger-solid focus:border-danger-solid'
          : 'border-border-strong hover:border-accent-border-hover focus:border-border-focus',
        'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-content-muted',
        local.class,
      )}
      {...rest}
    />
  );
}
