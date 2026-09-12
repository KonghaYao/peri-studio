import { Show } from 'solid-js';

/** Composer drop 激活时的半透明覆盖层（低于 slash menu）。 */
export function ComposerDropOverlay(props: { active: boolean; describedById: string }) {
  return (
    <Show when={props.active}>
      <div class="composer-drop-overlay pointer-events-none absolute inset-0 z-10 grid place-items-center">
        <p id={props.describedById} class="rounded-md border border-accent-border-hover bg-surface-overlay px-12 py-8 text-12 font-medium text-accent-solid shadow-raised">
          Release to upload files to this project
        </p>
      </div>
    </Show>
  );
}
