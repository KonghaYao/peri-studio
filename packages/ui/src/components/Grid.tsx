import {
  createContext,
  createMemo,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import { mergeInlineStyle } from '../lib/merge-style';
import { GRID_BREAKPOINT_ORDER, useGridBreakpoint, type GridBreakpoint } from '../lib/breakpoints';
import { resolveLayoutGapPx, type LayoutGapSize } from '../lib/layout-gap';

export type GridGutter = LayoutGapSize | Partial<Record<GridBreakpoint, LayoutGapSize>>;

export type ColSizeConfig = {
  span?: number;
  offset?: number;
  order?: number;
  flex?: string | number;
};

type RowAlign = 'top' | 'middle' | 'bottom' | 'stretch';
type RowJustify = 'start' | 'end' | 'center' | 'space-around' | 'space-between' | 'space-evenly';

interface RowContextValue {
  gutter: [number, number];
  wrap: boolean;
}

const RowContext = createContext<RowContextValue>({ gutter: [0, 0], wrap: true });

const ROW_ALIGN: Record<RowAlign, string> = {
  top: 'items-start',
  middle: 'items-center',
  bottom: 'items-end',
  stretch: 'items-stretch',
};

const ROW_JUSTIFY: Record<RowJustify, string> = {
  start: 'justify-start',
  end: 'justify-end',
  center: 'justify-center',
  'space-around': 'justify-around',
  'space-between': 'justify-between',
  'space-evenly': 'justify-evenly',
};

function resolveGutterValue(
  gutter: GridGutter | undefined,
  breakpoint: GridBreakpoint,
): number {
  if (gutter === undefined) return 0;
  if (typeof gutter === 'number' || typeof gutter === 'string') {
    return resolveLayoutGapPx(gutter);
  }
  for (const key of GRID_BREAKPOINT_ORDER) {
    if (GRID_BREAKPOINT_ORDER.indexOf(key) > GRID_BREAKPOINT_ORDER.indexOf(breakpoint)) continue;
    const value = gutter[key];
    if (value !== undefined) {
      return resolveLayoutGapPx(value);
    }
  }
  return 0;
}

type RowProps = ComponentProps<'div'> & {
  gutter?: GridGutter | [GridGutter, GridGutter];
  align?: RowAlign;
  justify?: RowJustify;
  wrap?: boolean;
};

export const Row: Component<RowProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'gutter', 'align', 'justify', 'wrap', 'style']);
  const breakpoint = useGridBreakpoint();

  const gutters = createMemo(() => {
    const gutter = local.gutter;
    if (Array.isArray(gutter)) {
      return [
        resolveGutterValue(gutter[0], breakpoint()),
        resolveGutterValue(gutter[1], breakpoint()),
      ] as [number, number];
    }
    const value = resolveGutterValue(gutter, breakpoint());
    return [value, value] as [number, number];
  });

  const rowStyle = (): JSX.CSSProperties | undefined => {
    const [h, v] = gutters();
    const patch: JSX.CSSProperties = {};
    if (h > 0) patch['margin-inline'] = `${-h / 2}px`;
    if (v > 0) patch['row-gap'] = `${v}px`;
    return mergeInlineStyle(local.style, patch);
  };

  return (
    <RowContext.Provider value={{ gutter: gutters(), wrap: local.wrap ?? true }}>
      <div
        data-slot="row"
        class={cn(
          'ui-grid-row flex flex-wrap',
          local.align ? ROW_ALIGN[local.align] : undefined,
          local.justify ? ROW_JUSTIFY[local.justify] : undefined,
          local.wrap === false && 'flex-nowrap',
          local.class,
        )}
        style={rowStyle()}
        {...rest}
      >
        {local.children}
      </div>
    </RowContext.Provider>
  );
};

export type ColProps = ComponentProps<'div'> & {
  span?: number;
  offset?: number;
  order?: number;
  push?: number;
  pull?: number;
  flex?: string | number;
  xs?: number | ColSizeConfig;
  sm?: number | ColSizeConfig;
  md?: number | ColSizeConfig;
  lg?: number | ColSizeConfig;
  xl?: number | ColSizeConfig;
};

function normalizeColSize(value?: number | ColSizeConfig): ColSizeConfig {
  if (value === undefined) return {};
  if (typeof value === 'number') return { span: value };
  return value;
}

function resolveColSize(props: ColProps, breakpoint: GridBreakpoint): ColSizeConfig {
  const responsiveKeys: GridBreakpoint[] = ['xs', 'sm', 'md', 'lg', 'xl'];
  let merged: ColSizeConfig = {
    span: props.span,
    offset: props.offset,
    order: props.order,
    flex: props.flex,
  };

  for (const key of responsiveKeys) {
    const prop = props[key];
    if (prop === undefined) continue;
    if (GRID_BREAKPOINT_ORDER.indexOf(breakpoint) > GRID_BREAKPOINT_ORDER.indexOf(key)) continue;
    merged = { ...merged, ...normalizeColSize(prop) };
  }

  return merged;
}

function parseFlex(flex: string | number): string {
  if (flex === 'auto') return '1 1 auto';
  if (typeof flex === 'number') return `${flex} ${flex} auto`;
  return flex;
}

export const Col: Component<ColProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'span',
    'offset',
    'order',
    'push',
    'pull',
    'flex',
    'xs',
    'sm',
    'md',
    'lg',
    'xl',
    'style',
  ]);
  const row = useContext(RowContext);
  const breakpoint = useGridBreakpoint();

  const size = createMemo(() => resolveColSize(local, breakpoint()));

  const colStyle = (): JSX.CSSProperties | undefined => {
    const config = size();
    const span = config.span ?? 24;
    const base =
      typeof local.style === 'object' && local.style !== null ? { ...local.style } : ({} as JSX.CSSProperties);
    const [gutterH] = row.gutter;
    if (gutterH > 0) {
      base['padding-inline'] = `${gutterH / 2}px`;
    }
    if (config.flex !== undefined) {
      base.flex = parseFlex(config.flex);
      if (!row.wrap) base['min-width'] = '0';
    } else {
      const percent = (span / 24) * 100;
      base.flex = `0 0 ${percent}%`;
      base['max-width'] = `${percent}%`;
    }
    if (config.offset) {
      base['margin-inline-start'] = `${(config.offset / 24) * 100}%`;
    }
    if (config.order !== undefined) {
      base.order = config.order;
    }
    return mergeInlineStyle(local.style, base);
  };

  return (
    <div data-slot="col" class={cn('ui-grid-col box-border min-h-px', local.class)} style={colStyle()} {...rest}>
      {local.children}
    </div>
  );
};
