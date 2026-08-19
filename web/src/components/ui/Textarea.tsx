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
  }} class={`ui-textarea${local.variant ? ` ui-textarea--${local.variant}` : ''} ${local.class ?? ''}`} />;
  return <Show when={local.label || local.hint || local.error} fallback={control}>
    <div class="ui-field">
      <Show when={local.label}><label class="ui-field__label" for={id()}>{local.label}</label></Show>
      {control}
      <Show when={local.hint}><span id={hintId()} class="ui-field__hint">{local.hint}</span></Show>
      <Show when={local.error}><span id={errorId()} class="ui-error">{local.error}</span></Show>
    </div>
  </Show>;
}
