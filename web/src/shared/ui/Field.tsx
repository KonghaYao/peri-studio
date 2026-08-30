import { createUniqueId, Show, splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';

const fieldControlClasses = (invalid?: boolean, className?: string) => cn(
  'box-border h-32 w-full rounded-6 border bg-surface px-12 text-13 text-text-primary outline-none [transition:border-color_120ms_ease,box-shadow_120ms_ease]',
  'placeholder:text-text-faint',
  invalid
    ? 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_25%,transparent)]'
    : 'border-border-strong hover:border-[color-mix(in_srgb,var(--accent)_30%,var(--border-strong))] focus:border-focus-ring focus:shadow-accent-ring',
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted',
  className,
);

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
      <input {...input} id={id()} aria-invalid={local.error ? 'true' : undefined} aria-describedby={describedBy()} class={fieldControlClasses(!!local.error, local.class)} />
      <Show when={local.hint}><span id={hintId()} class="text-11 text-text-muted">{local.hint}</span></Show>
      <Show when={local.error}><span id={errorId()} class="m-0 text-13 text-danger">{local.error}</span></Show>
    </div>
  );
}
