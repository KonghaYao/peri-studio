/** Ant Design 对齐的预设间距尺寸 → design token。 */
export type LayoutGapSize = 'small' | 'middle' | 'large' | number;

const GAP_TOKEN_MAP: Record<'small' | 'middle' | 'large', string> = {
  small: 'var(--space-8)',
  middle: 'var(--space-16)',
  large: 'var(--space-24)',
};

export function resolveLayoutGap(gap?: LayoutGapSize): string | undefined {
  if (gap === undefined) return undefined;
  if (typeof gap === 'number') return `${gap}px`;
  return GAP_TOKEN_MAP[gap];
}

export function resolveLayoutGapPair(
  gap?: LayoutGapSize | [LayoutGapSize, LayoutGapSize],
): [string | undefined, string | undefined] {
  if (gap === undefined) return [undefined, undefined];
  if (Array.isArray(gap)) {
    return [resolveLayoutGap(gap[0]), resolveLayoutGap(gap[1])];
  }
  const resolved = resolveLayoutGap(gap);
  return [resolved, resolved];
}

/** 将预设间距解析为像素，供栅格 gutter 计算。 */
export function resolveLayoutGapPx(gap?: LayoutGapSize): number {
  if (gap === undefined) return 0;
  if (typeof gap === 'number') return gap;
  if (gap === 'small') return 8;
  if (gap === 'middle') return 16;
  if (gap === 'large') return 24;
  return 0;
}
