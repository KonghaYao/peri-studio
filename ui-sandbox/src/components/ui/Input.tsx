import { splitProps, type JSX } from 'solid-js';
import { cn } from '@/lib/cn';

/* AntD 输入框：灰边 → hover 浅主色边 → focus 主色边 + 浅光晕 */
export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const [local, rest] = splitProps(props, ['class', 'invalid']);
  return (
    <input
      aria-invalid={local.invalid || undefined}
      class={cn(
        'h-(--control-height-md) w-full rounded-md border bg-surface-overlay px-3 text-13 text-content-primary outline-none transition-colors duration-(--duration-fast)',
        'placeholder:text-content-faint',
        local.invalid
          ? 'border-danger-solid focus:border-danger-solid focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--feedback-danger-solid)_25%,transparent)]'
          : 'border-border-strong hover:border-accent-border-hover focus:border-border-focus focus:shadow-(--shadow-focus-ring)',
        'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-content-muted',
        local.class,
      )}
      {...rest}
    />
  );
}
