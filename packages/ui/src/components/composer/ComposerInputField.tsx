import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { Textarea } from '../Textarea';

export type ComposerInputHint = {
  kind: 'prediction' | 'placeholder';
  text: string;
};

export type ComposerInputFieldProps = {
  centered?: boolean;
  hint?: ComposerInputHint | null;
  fieldClass?: string;
  class?: string;
  ref?: (el: HTMLTextAreaElement | undefined) => void;
} & Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, 'class'>;

function fieldClasses(centered: boolean, fieldClass?: string) {
  return cn(
    'ui-composer-editor__field block w-full resize-none overflow-y-auto border-0 bg-transparent px-1 py-8 outline-0',
    centered ? 'min-h-72 max-h-180 text-14 leading-22' : 'min-h-36 max-h-180 text-13 leading-normal',
    fieldClass,
  );
}

/** Composer 输入区视觉壳：placeholder / prediction 叠层 + bare Textarea。 */
export const ComposerInputField: Component<ComposerInputFieldProps> = (props) => {
  const [local, textarea] = splitProps(props, ['centered', 'hint', 'fieldClass', 'class', 'ref']);
  const centered = () => local.centered ?? false;
  const resolvedFieldClass = () => fieldClasses(centered(), local.fieldClass);

  return (
    <div class="ui-composer-editor relative">
      <Show when={local.hint}>
        {(hint) => (
          <>
            <div
              data-testid={hint().kind === 'prediction' ? 'composer-prediction' : 'composer-placeholder-hint'}
              class={cn(
                'ui-composer-editor__hint',
                resolvedFieldClass(),
                hint().kind === 'prediction'
                  ? 'text-content-faint ui-composer-editor__hint--prediction'
                  : 'text-content-muted',
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
        maxHeight={180}
        variant="bare"
        data-testid="composer-input"
        class={cn(
          'ui-composer-input ui-scrollbar relative z-1 placeholder:text-content-muted disabled:bg-transparent disabled:text-content-secondary focus-visible:outline-0',
          resolvedFieldClass(),
          local.class,
        )}
      />
    </div>
  );
};
