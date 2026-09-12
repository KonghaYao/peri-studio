import type { Component, JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../lib/cn';

type AspectRatioProps = {
  /** 宽高比，例如 16 / 9 */
  ratio: number;
  class?: string;
  children?: JSX.Element;
};

/** 固定宽高比容器：内层 overflow-hidden，比例通过 CSS aspect-ratio 设置。 */
export const AspectRatio: Component<AspectRatioProps> = (props) => {
  const [local, rest] = splitProps(props, ['ratio', 'class', 'children']);
  return (
    <div
      data-slot="aspect-ratio"
      class={cn('relative w-full', local.class)}
      style={{ 'aspect-ratio': String(local.ratio) }}
      {...rest}
    >
      <div class="absolute inset-0 overflow-hidden">
        {local.children}
      </div>
    </div>
  );
};
