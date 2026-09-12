import type { ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as ProgressPrimitive from '@kobalte/core/progress';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';

export const Progress = ProgressPrimitive.Root;

type TrackProps<T extends ValidComponent = 'div'> = ProgressPrimitive.ProgressTrackProps<T> & { class?: string };
export function ProgressTrack<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, TrackProps<T>>) {
  const [local, rest] = splitProps(props as TrackProps, ['class']);
  return (
    <ProgressPrimitive.Track
      class={cn('relative h-8 w-full overflow-hidden rounded-full bg-surface-sunken', local.class)}
      {...rest}
    />
  );
}

type FillProps<T extends ValidComponent = 'div'> = ProgressPrimitive.ProgressFillProps<T> & { class?: string };
export function ProgressFill<T extends ValidComponent = 'div'>(props: PolymorphicProps<T, FillProps<T>>) {
  const [local, rest] = splitProps(props as FillProps, ['class']);
  return (
    <ProgressPrimitive.Fill
      class={cn(
        'ui-progress-fill h-full rounded-l-full bg-accent-solid ui-control-transition',
        local.class,
      )}
      {...rest}
    />
  );
}

export const ProgressLabel = ProgressPrimitive.Label;
export const ProgressValueLabel = ProgressPrimitive.ValueLabel;
