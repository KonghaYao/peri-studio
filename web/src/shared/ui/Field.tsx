import { createUniqueId, Show, splitProps, type JSX } from 'solid-js';

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
      <input {...input} id={id()} aria-invalid={local.error ? 'true' : undefined} aria-describedby={describedBy()} class={`box-border h-34 w-full rounded-9 border border-border-strong bg-surface px-11 text-text-primary outline-none focus:border-focus-ring focus:shadow-[0_0_0_1px_var(--surface),0_0_0_3px_var(--focus-ring)] focus-visible:outline-0 ${local.class ?? ''}`} />
      <Show when={local.hint}><span id={hintId()} class="text-11 text-text-muted">{local.hint}</span></Show>
      <Show when={local.error}><span id={errorId()} class="m-0 text-13 text-danger">{local.error}</span></Show>
    </div>
  );
}
