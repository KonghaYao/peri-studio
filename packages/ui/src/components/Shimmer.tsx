import { splitProps, type Component, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../lib/cn';

type ShimmerElement = keyof JSX.IntrinsicElements;

export type ShimmerProps = {
  as?: ShimmerElement;
  class?: string;
  children?: JSX.Element;
  /** 单次扫光周期（秒）；默认 2，Reasoning 流式常用 1。 */
  duration?: number;
  /** 扫光宽度 = 字符数 × spread；默认 2（对齐 AI Elements）。 */
  spread?: number;
};

function shimmerText(children: JSX.Element | undefined): string {
  if (children == null) return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map((child) => shimmerText(child as JSX.Element)).join('');
  return '';
}

/** 文本扫光，对齐 Vercel AI Elements `Shimmer`（动态 spread + 双图层渐变）。 */
export const Shimmer: Component<ShimmerProps> = (props) => {
  const [local, rest] = splitProps(props, ['as', 'class', 'children', 'duration', 'spread']);
  const tag = () => local.as ?? 'span';
  const spreadPx = () => (local.spread ?? 2) * Math.max(1, shimmerText(local.children).length);

  return (
    <Dynamic
      component={tag()}
      data-slot="shimmer"
      class={cn('ui-ai-shimmer', local.class)}
      style={{
        '--shimmer-spread-px': `${spreadPx()}px`,
        '--shimmer-duration': `${local.duration ?? 2}s`,
      }}
      {...rest}
    >
      {local.children}
    </Dynamic>
  );
};
