import { createUniqueId, Show, splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';

const fieldControlClasses = (invalid?: boolean, className?: string) => cn(
  'box-border h-36 w-full rounded-6 border bg-surface px-12 text-13 text-text-primary outline-none ui-control-transition',
  'placeholder:text-text-faint',
  invalid
    ? 'border-danger focus:border-danger'
    : 'border-border-strong hover:border-accent-border-hover focus:border-focus-ring',
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted',
  className,
);

/** Bare text control without label chrome. */
export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const [local, input] = splitProps(props, ['class', 'invalid']);
  return (
    <input
      {...input}
      aria-invalid={local.invalid ? 'true' : undefined}
      class={fieldControlClasses(!!local.invalid, local.class)}
    />
  );
}

export function TextField(props: JSX.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }) {
  const [local, input] = splitProps(props, ['label', 'hint', 'error', 'class', 'id', 'aria-describedby']);
  const generated = createUniqueId();
  const id = () => local.id || `field-${generated}`;
  const hintId = () => local.hint ? `${id()}-hint` : undefined;
  const errorId = () => local.error ? `${id()}-error` : undefined;
  const describedBy = () => [local['aria-describedby'], hintId(), errorId()].filter(Boolean).join(' ') || undefined;
  return (
    <div class="mb-9 flex flex-col gap-6">
      <Show when={local.label}><label class="text-12 font-semibold text-text-secondary" for={id()}>{local.label}</label></Show>
      <Input {...input} id={id()} invalid={!!local.error} aria-describedby={describedBy()} class={local.class} />
      <Show when={local.hint}><span id={hintId()} class="text-11 text-text-muted">{local.hint}</span></Show>
      <Show when={local.error}><span id={errorId()} class="m-0 text-13 text-danger">{local.error}</span></Show>
    </div>
  );
}
