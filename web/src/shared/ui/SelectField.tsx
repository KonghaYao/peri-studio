import { createUniqueId, Show, splitProps, type JSX } from 'solid-js';

type Props = JSX.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export function SelectField(props: Props) {
  const [local, select] = splitProps(props, ['label', 'hint', 'error', 'id', 'class', 'children', 'aria-describedby']);
  const generated = createUniqueId();
  const id = () => local.id || `select-${generated}`;
  const hintId = () => `${id()}-hint`;
  const errorId = () => `${id()}-error`;
  const describedBy = () => [local['aria-describedby'], local.hint ? hintId() : '', local.error ? errorId() : ''].filter(Boolean).join(' ') || undefined;
  return <div class="mb-9 flex flex-col gap-6">
    <label class="text-12 font-semibold text-text-secondary" for={id()}>{local.label}</label>
    <select {...select} id={id()} aria-invalid={local.error ? 'true' : undefined} aria-describedby={describedBy()} class={`box-border h-38 w-full appearance-auto rounded-9 border border-border-strong bg-surface px-11 text-text-primary outline-none focus:border-focus-ring focus:shadow-[0_0_0_1px_var(--surface),0_0_0_3px_var(--focus-ring)] focus-visible:outline-0 ${local.class ?? ''}`}>{local.children}</select>
    <Show when={local.hint}><span id={hintId()} class="text-11 text-text-muted">{local.hint}</span></Show>
    <Show when={local.error}><span id={errorId()} class="m-0 text-13 text-danger">{local.error}</span></Show>
  </div>;
}
