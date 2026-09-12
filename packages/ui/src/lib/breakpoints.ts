import { createSignal, onCleanup, onMount } from 'solid-js';

/** 与 theme.css 断点对齐的栅格断点键。 */
export const GRID_BREAKPOINTS = {
  xs: 0,
  sm: 640,
  md: 760,
  lg: 960,
  xl: 1200,
} as const;

export type GridBreakpoint = keyof typeof GRID_BREAKPOINTS;

export const GRID_BREAKPOINT_ORDER: GridBreakpoint[] = ['xl', 'lg', 'md', 'sm', 'xs'];

export function matchGridBreakpoint(width: number): GridBreakpoint {
  if (width >= GRID_BREAKPOINTS.xl) return 'xl';
  if (width >= GRID_BREAKPOINTS.lg) return 'lg';
  if (width >= GRID_BREAKPOINTS.md) return 'md';
  if (width >= GRID_BREAKPOINTS.sm) return 'sm';
  return 'xs';
}

export function useGridBreakpoint() {
  const [breakpoint, setBreakpoint] = createSignal<GridBreakpoint>('xs');

  onMount(() => {
    const update = () => setBreakpoint(matchGridBreakpoint(window.innerWidth));
    update();
    window.addEventListener('resize', update, { passive: true });
    onCleanup(() => window.removeEventListener('resize', update));
  });

  return breakpoint;
}
