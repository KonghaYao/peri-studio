import { splitProps, type ComponentProps } from 'solid-js';
import { cn } from '../../lib/cn';

/** Shared composer shell surface (border, radius, overlay background). */
export const composerSurfaceClass =
  'relative overflow-hidden border border-composer-border rounded-(--composer-radius) bg-surface-overlay p-2.5 max-narrow:rounded-16';

export type ComposerSurfaceProps = ComponentProps<'div'>;

/** @deprecated 使用 {@link ComposerShell}（T3 双形态壳）。 */
export function ComposerSurface(props: ComposerSurfaceProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div
      data-slot="composer-surface"
      class={cn(composerSurfaceClass, local.class)}
      {...rest}
    >
      {local.children}
    </div>
  );
}
