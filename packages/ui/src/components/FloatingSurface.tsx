import { splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';

export type FloatingSurfaceProps = {
  class?: string;
  children?: JSX.Element;
};

/** Popper 内层视觉壳：动画与 transform-origin 须与 Kobalte translate3d 定位层分离。 */
export function FloatingSurface(props: FloatingSurfaceProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div class={cn(local.class)} {...rest}>
      {local.children}
    </div>
  );
}
