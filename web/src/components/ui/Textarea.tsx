import { createEffect, createUniqueId, Show, splitProps, type JSX } from 'solid-js';

type Props = JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  autoResize?: boolean;
  maxHeight?: number;
  label?: string;
  hint?: string;
  error?: string;
  variant?: 'field' | 'bare';
};

/** Controlled textarea with the same finite auto-growth contract as Composer. */
export function Textarea(props: Props) {
  const [local, textarea] = splitProps(props, ['autoResize', 'maxHeight', 'label', 'hint', 'error', 'variant', 'class', 'id', 'aria-describedby', 'ref']);
  const generated = createUniqueId();
  const id = () => local.id || `textarea-${generated}`;
  const hintId = () => local.hint ? `${id()}-hint` : undefined;
  const errorId = () => local.error ? `${id()}-error` : undefined;
  const describedBy = () => [local['aria-describedby'], hintId(), errorId()].filter(Boolean).join(' ') || undefined;
  let element: HTMLTextAreaElement | undefined;
  const resize = () => {
    if (!local.autoResize || !element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, local.maxHeight ?? 180)}px`;
  };
  createEffect(() => { textarea.value; queueMicrotask(resize); });
  const control = <textarea {...textarea} id={id()} aria-invalid={local.error ? 'true' : undefined} aria-describedby={describedBy()} ref={(node) => {
    element = node;
    if (typeof local.ref === 'function') local.ref(node);
  }} onInput={(event) => {
    resize();
    const handler = textarea.onInput;
    if (typeof handler === 'function') handler(event);
  }} class={`${local.variant === 'field' ? 'box-border min-h-82 w-full resize-y rounded-12 border border-border-strong bg-surface px-12 py-11 text-13 text-text-primary leading-15 outline-none focus-visible:border-focus-ring focus-visible:shadow-[0_0_0_2px_var(--focus-ring)]' : '[font-family:inherit]'} ${local.class ?? ''}`} />;
  return <Show when={local.label || local.hint || local.error} fallback={control}>
    <div class="mb-9 flex flex-col gap-6">
      <Show when={local.label}><label class="text-12 font-semibold text-text-secondary" for={id()}>{local.label}</label></Show>
      {control}
      <Show when={local.hint}><span id={hintId()} class="text-11 text-text-muted">{local.hint}</span></Show>
      <Show when={local.error}><span id={errorId()} class="m-0 text-13 text-danger">{local.error}</span></Show>
    </div>
  </Show>;
}
