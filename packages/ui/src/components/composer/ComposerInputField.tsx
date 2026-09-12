import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { Textarea } from '../Textarea';
import {
  composerEditorClass,
  composerEditorHintClass,
  composerEditorHintPredictionClass,
  composerEditorLayerClass,
  composerInputClass,
} from './composer-layout';

export type ComposerInputHint = {
  kind: 'prediction' | 'placeholder';
  text: string;
};

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

/** Composer 输入区视觉壳：placeholder / prediction 叠层 + bare Textarea。 */
export const ComposerInputField: Component<ComposerInputFieldProps> = (props) => {
  const [local, textarea] = splitProps(props, ['centered', 'shell', 'hint', 'fieldClass', 'maxHeight', 'class', 'ref']);
  const centered = () => local.centered ?? false;
  const shell = () => local.shell ?? false;
  const resolvedFieldClass = () => fieldClasses(centered(), shell(), local.fieldClass);

  return (
    <div class={composerEditorClass}>
      <Show when={local.hint}>
        {(hint) => (
          <>
            <div
              data-testid={hint().kind === 'prediction' ? 'composer-prediction' : 'composer-placeholder-hint'}
              class={cn(
                composerEditorLayerClass,
                composerEditorHintClass,
                resolvedFieldClass(),
                hint().kind === 'prediction' && composerEditorHintPredictionClass,
              )}
              aria-hidden="true"
            >
              {hint().text}
            </div>
            <Show when={hint().kind === 'prediction'}>
              <span id="composer-prediction-description" class="sr-only">
                Peri suggests: {hint().text}. Press Tab to use it, or Escape to ignore.
              </span>
            </Show>
          </>
        )}
      </Show>
      <Textarea
        {...textarea}
        ref={local.ref}
        autoResize
        maxHeight={local.maxHeight ?? 180}
        variant="bare"
        data-testid="composer-input"
        class={cn(
          composerEditorLayerClass,
          composerInputClass,
          'ui-scrollbar disabled:bg-transparent disabled:text-content-secondary focus-visible:outline-0',
          resolvedFieldClass(),
          local.class,
        )}
      />
    </div>
  );
};
