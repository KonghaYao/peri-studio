import { Show, createEffect, createSignal, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { Textarea } from '../Textarea';
import {
  composerEditorClass,
  composerEditorHintClass,
  composerEditorHintDictationClass,
  composerEditorHintPredictionClass,
  composerEditorLayerClass,
  composerInputClass,
} from './composer-layout';

export type ComposerInputHint =
  | { kind: 'prediction' | 'placeholder'; text: string }
  | { kind: 'dictation'; prefix: string; text: string };

export type ComposerInputFieldProps = {
  centered?: boolean;
  /** ComposerShell 内联字段：尺寸由 composer-layout 常量控制 */
  shell?: boolean;
  hint?: ComposerInputHint | null;
  fieldClass?: string;
  maxHeight?: number;
  class?: string;
  ref?: (el: HTMLTextAreaElement | undefined) => void;
} & Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, 'class' | 'maxHeight'>;

function fieldClasses(centered: boolean, shell: boolean, fieldClass?: string) {
  return cn(
    'block w-full resize-none overflow-y-auto border-0 bg-transparent outline-0',
    shell
      ? 'px-0 py-0'
      : cn(
          'px-1 py-8',
          centered ? 'min-h-72 max-h-180 text-14 leading-22' : 'min-h-36 max-h-180 text-13 leading-normal',
        ),
    fieldClass,
  );
}

function hintTestId(hint: ComposerInputHint): string {
  if (hint.kind === 'prediction') return 'composer-prediction';
  if (hint.kind === 'dictation') return 'composer-dictation-preview';
  return 'composer-placeholder-hint';
}

function HintOverlayBody(props: { hint: ComposerInputHint }) {
  const hint = props.hint;
  if (hint.kind === 'dictation') {
    return (
      <>
        {hint.prefix}
        <span class="text-content-muted">{hint.text}</span>
      </>
    );
  }
  return hint.text;
}

function HintOverlay(props: { hint: ComposerInputHint; fieldClass: string }) {
  return (
    <>
      <div
        data-testid={hintTestId(props.hint)}
        class={cn(
          composerEditorLayerClass,
          props.hint.kind === 'dictation' ? composerEditorHintDictationClass : composerEditorHintClass,
          props.fieldClass,
          props.hint.kind === 'prediction' && composerEditorHintPredictionClass,
        )}
        aria-hidden="true"
      >
        <HintOverlayBody hint={props.hint} />
      </div>
      <Show when={props.hint.kind === 'prediction'}>
        <span id="composer-prediction-description" class="sr-only">
          Peri suggests: {props.hint.text}. Press Tab to use it, or Escape to ignore.
        </span>
      </Show>
    </>
  );
}

/** Composer 输入区视觉壳：placeholder / prediction / dictation 叠层 + bare Textarea。 */
export const ComposerInputField: Component<ComposerInputFieldProps> = (props) => {
  const [local, textarea] = splitProps(props, [
    'centered',
    'shell',
    'hint',
    'fieldClass',
    'maxHeight',
    'class',
    'ref',
    'onInput',
    'onCompositionStart',
    'onCompositionEnd',
  ]);
  const centered = () => local.centered ?? false;
  const shell = () => local.shell ?? false;
  const resolvedFieldClass = () => fieldClasses(centered(), shell(), local.fieldClass);
  const [composing, setComposing] = createSignal(false);
  const [occupied, setOccupied] = createSignal(false);

  createEffect(() => {
    const controlled = `${textarea.value ?? ''}`;
    if (controlled.length > 0) setOccupied(true);
    else if (!composing()) setOccupied(false);
  });

  const overlayHint = () => {
    const hint = local.hint ?? null;
    if (composing()) return null;
    if (hint?.kind === 'dictation' && hint.text) return hint;
    if (occupied()) return null;
    return hint;
  };

  const dictationPreview = () => overlayHint()?.kind === 'dictation';

  const markOccupied = (element: HTMLTextAreaElement) => {
    setOccupied(element.value.length > 0);
  };

  return (
    <div class={composerEditorClass}>
      <Show when={overlayHint()}>
        {(hint) => <HintOverlay hint={hint()} fieldClass={resolvedFieldClass()} />}
      </Show>
      <Textarea
        {...textarea}
        ref={local.ref}
        autoResize
        maxHeight={local.maxHeight ?? 180}
        variant="bare"
        data-testid="composer-input"
        onInput={(event) => {
          markOccupied(event.currentTarget);
          const handler = local.onInput;
          if (typeof handler === 'function') handler(event);
        }}
        onCompositionStart={(event) => {
          setComposing(true);
          const handler = local.onCompositionStart;
          if (typeof handler === 'function') handler(event);
        }}
        onCompositionEnd={(event) => {
          setComposing(false);
          markOccupied(event.currentTarget);
          const handler = local.onCompositionEnd;
          if (typeof handler === 'function') handler(event);
        }}
        class={cn(
          composerEditorLayerClass,
          composerInputClass,
          'ui-scrollbar disabled:bg-transparent disabled:text-content-secondary focus-visible:outline-0',
          resolvedFieldClass(),
          dictationPreview() && 'text-transparent caret-content-primary',
          local.class,
        )}
      />
    </div>
  );
};
