import { splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';

type ShimmerProps = ComponentProps<'span'> & {
  /** 单次扫光周期（秒）；默认沿用 tokens 的 --shimmer-duration。 */
  duration?: number;
};

/** 文本扫光占位，对齐 AI Elements Shimmer；底层使用 `.shimmer` utility。 */
export const Shimmer: Component<ShimmerProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'duration']);

  return (
    <span
      data-slot="shimmer"
      class={cn('shimmer', local.class)}
      style={
        local.duration === undefined
          ? undefined
          : ({ '--shimmer-duration': `${local.duration}s` } as Record<string, string>)
      }
      {...rest}
    >
      {local.children}
    </span>
  );
};
