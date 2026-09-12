import { For, Show, splitProps, type Component } from 'solid-js';
import { cn } from '../lib/cn';
import { Slider, SliderFill, SliderThumb, SliderTrack } from './Slider';

export type SliderMark = {
  value: number;
  label?: string;
};

export type SliderWithMarksProps = {
  value?: number[];
  defaultValue?: number[];
  onChange?: (value: number[]) => void;
  minValue?: number;
  maxValue?: number;
  step?: number;
  marks?: SliderMark[];
  vertical?: boolean;
  formatTooltip?: (value: number) => string;
  class?: string;
};

function ShowMarks(props: {
  marks?: SliderMark[];
  vertical?: boolean;
  position: (value: number) => string;
}) {
  return (
    <Show when={props.marks?.length}>
      <div
        class={cn(
          'relative text-12 text-text-muted',
          props.vertical ? 'h-full w-40' : 'h-20 w-full',
        )}
      >
        <For each={props.marks}>
          {(mark) => (
            <span
              class="absolute whitespace-nowrap"
              style={props.vertical
                ? { bottom: props.position(mark.value), left: '0' }
                : { left: props.position(mark.value), top: '0', transform: 'translateX(-50%)' }}
            >
              {mark.label ?? mark.value}
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}

/** 带刻度与可选垂直方向的 Slider 组合件。 */
export const SliderWithMarks: Component<SliderWithMarksProps> = (props) => {
  const [local] = splitProps(props, [
    'value',
    'defaultValue',
    'onChange',
    'minValue',
    'maxValue',
    'step',
    'marks',
    'vertical',
    'formatTooltip',
    'class',
  ]);
  const range = () => (local.maxValue ?? 100) - (local.minValue ?? 0);

  const position = (value: number) => {
    const min = local.minValue ?? 0;
    return `${((value - min) / range()) * 100}%`;
  };

  return (
    <div
      data-slot="slider-marks"
      class={cn(
        'flex gap-12',
        local.vertical ? 'h-200 flex-row' : 'w-full flex-col',
        local.class,
      )}
    >
      <Slider
        class={cn(local.vertical ? 'h-full w-8' : 'w-full')}
        value={local.value}
        defaultValue={local.defaultValue}
        onChange={local.onChange}
        minValue={local.minValue}
        maxValue={local.maxValue}
        step={local.step}
        orientation={local.vertical ? 'vertical' : 'horizontal'}
      >
        <SliderTrack>
          <SliderFill />
          <SliderThumb aria-label={local.formatTooltip?.(local.value?.[0] ?? 0) ?? 'Slider thumb'} />
        </SliderTrack>
      </Slider>
      <ShowMarks marks={local.marks} vertical={local.vertical} position={position} />
    </div>
  );
};
