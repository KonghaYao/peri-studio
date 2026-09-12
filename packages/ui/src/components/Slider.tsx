import type { ValidComponent } from 'solid-js';
import { createMemo, splitProps } from 'solid-js';
import * as SliderPrimitive from '@kobalte/core/slider';
import { useSliderContext } from '@kobalte/core/slider';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';

export const Slider = SliderPrimitive.Root;

type TrackProps<T extends ValidComponent = 'div'> = SliderPrimitive.SliderTrackProps<T> & { class?: string };
export function SliderTrack<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, TrackProps<T>>) {
  const [local, rest] = splitProps(props as TrackProps, ['class']);
  return (
    <SliderPrimitive.Track
      class={cn(
        // Leave vertical room for the thumb; do not clip it with overflow-hidden.
        'relative my-4 h-8 w-full grow rounded-full bg-surface-sunken',
        local.class,
      )}
      {...rest}
    />
  );
}

type FillProps<T extends ValidComponent = 'div'> = SliderPrimitive.SliderFillProps<T> & { class?: string };
export function SliderFill<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, FillProps<T>>) {
  const [local, rest] = splitProps(props as FillProps, ['class']);
  return (
    <SliderPrimitive.Fill
      class={cn('absolute h-full rounded-l-full bg-accent-solid', local.class)}
      {...rest}
    />
  );
}

type ThumbProps<T extends ValidComponent = 'span'> = SliderPrimitive.SliderThumbProps<T> & { class?: string };
export function SliderThumb<T extends ValidComponent = 'span'>(props: PolymorphicProps<T, ThumbProps<T>>) {
  const context = useSliderContext();
  const [local, rest] = splitProps(props as ThumbProps, ['class', 'style']);
  const style = createMemo(() => {
    const base = typeof local.style === 'object' ? local.style : undefined;
    const values = context.state.values();
    if (values.length !== 1) return base;
    const percent = context.state.getValuePercent(values[0]) * 100;
    return {
      ...base,
      top: '50%',
      // Kobalte emits `calc(25%)`, which is invalid CSS — use a plain percentage instead.
      [context.startEdge()]: `${percent}%`,
    };
  });
  return (
    <SliderPrimitive.Thumb
      style={style()}
      class={cn(
        'top-1/2 z-10 -mt-8 block size-16 rounded-full border-2 border-accent-solid bg-surface shadow-raised ui-control-transition',
        'focus-visible:shadow-accent-ring focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-45',
        'pointer-coarse:min-h-44 pointer-coarse:min-w-44',
        local.class,
      )}
      {...rest}
    />
  );
}

export const SliderLabel = SliderPrimitive.Label;
