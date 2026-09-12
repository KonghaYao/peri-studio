import { createEffect, createUniqueId, Show, splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';

type Props = JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  autoResize?: boolean;
  maxHeight?: number;
  label?: string;
  hint?: string;
  error?: string;
  variant?: 'field' | 'bare';
};

const textareaControlClasses = (invalid?: boolean, autoResize?: boolean, className?: string) => cn(
  'box-border w-full rounded-6 border bg-surface px-12 py-8 text-13 leading-normal text-text-primary outline-none ui-control-transition',
  'placeholder:text-text-faint',
  autoResize ? 'min-h-36 resize-none' : 'min-h-36 resize-y',
  invalid
    ? 'border-danger focus:border-danger'
    : 'border-border-strong hover:border-accent-border-hover focus:border-focus-ring',
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted',
  className,
);

const textareaBareClasses = 'block w-full resize-none bg-transparent font-inherit outline-none';

/** Controlled textarea with the same finite auto-growth contract as Composer. */
export function Textarea(props: Props) {
  const [local, textarea] = splitProps(props, ['autoResize', 'maxHeight', 'label', 'hint', 'error', 'variant', 'class', 'id', 'aria-describedby', 'ref']);
  const generated = createUniqueId();
  const id = () => local.id || `textarea-${generated}`;
  const hintId = () => local.hint ? `${id()}-hint` : undefined;
  const errorId = () => local.error ? `${id()}-error` : undefined;
  const describedBy = () => [local['aria-describedby'], hintId(), errorId()].filter(Boolean).join(' ') || undefined;
  const variant = () => local.variant ?? 'field';
  const shouldAutoResize = () => local.autoResize ?? local.variant === 'field';
  let element: HTMLTextAreaElement | undefined;
  let composing = false;
  const resize = () => {
    if (!shouldAutoResize() || !element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, local.maxHeight ?? 180)}px`;
  };
  createEffect(() => {
    const next = `${textarea.value ?? ''}`;
    // IME 合成中不得回写受控 value，否则会重置合成并与布局测量互相触发。
    if (element && element.value !== next && !composing) element.value = next;
    if (!composing) queueMicrotask(resize);
  });
  const control = (
    <textarea
      {...textarea}
      value={textarea.value ?? ''}
      id={id()}
      aria-invalid={local.error ? 'true' : undefined}
      aria-describedby={describedBy()}
      ref={(node) => {
        element = node;
        if (typeof local.ref === 'function') local.ref(node);
        queueMicrotask(resize);
      }}
      onInput={(event) => {
        resize();
        if (typeof textarea.onInput === 'function') textarea.onInput(event);
      }}
      onKeyDown={(event) => {
        if (typeof textarea.onKeyDown === 'function') textarea.onKeyDown(event);
      }}
      onCompositionStart={(event) => {
        composing = true;
        if (typeof textarea.onCompositionStart === 'function') textarea.onCompositionStart(event);
      }}
      onCompositionEnd={(event) => {
        composing = false;
        if (typeof textarea.onCompositionEnd === 'function') textarea.onCompositionEnd(event);
        queueMicrotask(resize);
      }}
      onSelect={(event) => {
        if (typeof textarea.onSelect === 'function') textarea.onSelect(event);
      }}
      onBlur={(event) => {
        if (typeof textarea.onBlur === 'function') textarea.onBlur(event);
      }}
      class={cn(
        'ui-textarea',
        variant() === 'bare'
          ? textareaBareClasses
          : textareaControlClasses(!!local.error, shouldAutoResize(), local.class),
        local.class,
      )}
    />
  );
  return (
    <Show when={local.label || local.hint || local.error} fallback={control}>
      <div class="mb-9 flex flex-col gap-6">
        <Show when={local.label}><label class="text-12 font-semibold text-text-secondary" for={id()}>{local.label}</label></Show>
        {control}
        <Show when={local.hint}><span id={hintId()} class="text-11 text-text-muted">{local.hint}</span></Show>
        <Show when={local.error}><span id={errorId()} class="m-0 text-13 text-danger">{local.error}</span></Show>
      </div>
    </Show>
  );
}
