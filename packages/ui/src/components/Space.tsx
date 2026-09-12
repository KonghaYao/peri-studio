import { children, For, Show, splitProps, type Component, type ComponentProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { mergeInlineStyle } from '../lib/merge-style';
import { resolveLayoutGapPair, type LayoutGapSize } from '../lib/layout-gap';

export type SpaceSize = LayoutGapSize;

type SpaceAlign = 'start' | 'end' | 'center' | 'baseline';

const ALIGN_CLASS: Record<SpaceAlign, string> = {
  start: 'items-start',
  end: 'items-end',
  center: 'items-center',
  baseline: 'items-baseline',
};

type SpaceProps = ComponentProps<'div'> & {
  size?: SpaceSize | [SpaceSize, SpaceSize];
  /** @deprecated 使用 vertical */
  direction?: 'horizontal' | 'vertical';
  vertical?: boolean;
  orientation?: 'horizontal' | 'vertical';
  align?: SpaceAlign;
  wrap?: boolean;
  /** @deprecated 使用 separator */
  split?: JSX.Element;
  separator?: JSX.Element;
  compact?: boolean;
};

function isRenderableNode(node: unknown): boolean {
  return node !== null && node !== undefined && node !== false && node !== '';
}

function SpaceRoot(props: SpaceProps) {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'size',
    'direction',
    'vertical',
    'orientation',
    'align',
    'wrap',
    'split',
    'separator',
    'compact',
    'style',
  ]);

  const resolved = children(() => local.children);
  const nodes = () => resolved.toArray().filter(isRenderableNode);

  const isVertical = () =>
    local.vertical ??
    (local.orientation === 'vertical'
      ? true
      : local.orientation === 'horizontal'
        ? false
        : local.direction === 'vertical');

  const gapStyle = (): JSX.CSSProperties | undefined => {
    const [rowGap, columnGap] = resolveLayoutGapPair(local.size ?? (local.compact ? 'small' : 'middle'));
    const patch: JSX.CSSProperties = {};
    if (isVertical()) {
      if (rowGap) patch['row-gap'] = rowGap;
    } else if (columnGap) {
      patch['column-gap'] = columnGap;
    }
    return mergeInlineStyle(local.style, patch);
  };

  const divider = () => local.separator ?? local.split;

  return (
    <div
      data-slot="space"
      data-compact={local.compact ? 'true' : undefined}
      class={cn(
        'inline-flex max-w-full',
        isVertical() ? 'flex-col' : 'flex-row',
        local.wrap && 'flex-wrap',
        local.align ? ALIGN_CLASS[local.align] : isVertical() ? 'items-start' : 'items-center',
        local.class,
      )}
      style={gapStyle()}
      {...rest}
    >
      <For each={nodes()}>
        {(child, index) => (
          <>
            <Show when={index() > 0 && divider()}>
              <span data-slot="space-separator" class="inline-flex shrink-0 text-content-muted" aria-hidden="true">
                {divider()}
              </span>
            </Show>
            <span data-slot="space-item" class="inline-flex min-w-0">{child}</span>
          </>
        )}
      </For>
    </div>
  );
}

export const SpaceCompact: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div data-slot="space-compact" class={cn('ui-space-compact inline-flex', local.class)} {...rest}>
      {local.children}
    </div>
  );
};

export const Space = Object.assign(SpaceRoot, {
  Compact: SpaceCompact,
});
