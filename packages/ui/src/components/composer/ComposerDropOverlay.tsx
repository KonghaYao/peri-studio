import { Show, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';

export type ComposerDropOverlayProps = {
  active: boolean;
  describedById: string;
  class?: string;
  'data-testid'?: string;
};

/** Composer drop 激活时的半透明覆盖层。 */
export const ComposerDropOverlay: Component<ComposerDropOverlayProps> = (props) => {
  const [local, rest] = splitProps(props, ['active', 'describedById', 'class', 'data-testid']);
  return (
    <Show when={local.active}>
      <div
        class={cn(
          'ui-upload-drop-overlay pointer-events-none absolute inset-0 z-10 grid place-items-center',
          local.class,
        )}
        data-testid={local['data-testid']}
        {...rest}
      >
        <p
          id={local.describedById}
          class="rounded-md border border-accent-border-hover bg-surface-overlay px-12 py-8 text-12 font-medium text-accent-solid shadow-raised"
        >
          Release to upload files to this project
        </p>
      </div>
    </Show>
  );
};
