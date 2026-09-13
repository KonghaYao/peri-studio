import { For, type Component } from 'solid-js';
import { Slider, SliderFill, SliderThumb, SliderTrack } from '../Slider';

export type SettingsAppearanceMaterial = {
  id: string;
  label: string;
  /** 无纹理（None）时不设 preview，色板为纯色 Neutral 25。 */
  previewSrc?: string;
};

export type SettingsAppearancePaneProps = {
  materials: SettingsAppearanceMaterial[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** 选 None 时为 false，隐藏 Opacity / Blur / Hue。 */
  textureControlsEnabled?: boolean;
  fillPercent: number;
  onFillChange: (value: number) => void;
  washBlurPx: number;
  onWashBlurChange: (value: number) => void;
  washBlurMin?: number;
  washBlurMax?: number;
  washHueDeg: number;
  onWashHueChange: (value: number) => void;
  washHueMin?: number;
  washHueMax?: number;
};

/** T3 · Appearance 页：材质色板 + 透明度滑杆，无持久化。 */
export const SettingsAppearancePane: Component<SettingsAppearancePaneProps> = (props) => {
  const textureControlsEnabled = () => props.textureControlsEnabled ?? true;

  return (
    <div class="flex flex-col gap-20" data-testid="settings-appearance">
      <div class="flex flex-col gap-6">
        <h3 class="m-0 text-14 font-semibold text-text-primary">Appearance</h3>
        <p class="m-0 text-12 leading-155 text-text-secondary">
          Sidebar material and how much frost covers the wash.
        </p>
      </div>
      <div class="grid grid-cols-settings-swatches gap-12" role="group" aria-label="Materials">
        <For each={props.materials}>
          {(material) => {
            const selected = () => material.id === props.selectedId;
            return (
              <button
                type="button"
                class="ui-settings-swatch"
                aria-pressed={selected()}
                aria-label={material.label}
                data-testid={`appearance-material-${material.id}`}
                style={{
                  '--settings-swatch-image': material.previewSrc ? `url("${material.previewSrc}")` : 'none',
                }}
                onClick={() => props.onSelect(material.id)}
              >
                <span class="ui-settings-swatch-preview" aria-hidden="true" />
                <span class="truncate text-12 text-text-secondary">{material.label}</span>
              </button>
            );
          }}
        </For>
      </div>
      {textureControlsEnabled() ? (
      <div class="flex flex-col gap-16">
        <div class="flex flex-col gap-10">
          <div class="flex items-center justify-between gap-12">
            <label class="text-13 text-text-primary" for="settings-appearance-opacity">
              Opacity
            </label>
            <span class="text-12 text-text-muted">{`${props.fillPercent}%`}</span>
          </div>
          <Slider
            id="settings-appearance-opacity"
            minValue={0}
            maxValue={100}
            step={1}
            value={[props.fillPercent]}
            onChange={(values) => props.onFillChange(values[0] ?? props.fillPercent)}
          >
            <SliderTrack>
              <SliderFill />
              <SliderThumb aria-label="Opacity" />
            </SliderTrack>
          </Slider>
        </div>
        <div class="flex flex-col gap-10">
          <div class="flex items-center justify-between gap-12">
            <label class="text-13 text-text-primary" for="settings-appearance-blur">
              Blur
            </label>
            <span class="text-12 text-text-muted">{`${props.washBlurPx}px`}</span>
          </div>
          <Slider
            id="settings-appearance-blur"
            minValue={props.washBlurMin ?? 0}
            maxValue={props.washBlurMax ?? 24}
            step={1}
            value={[props.washBlurPx]}
            onChange={(values) => props.onWashBlurChange(values[0] ?? props.washBlurPx)}
          >
            <SliderTrack>
              <SliderFill />
              <SliderThumb aria-label="Blur" />
            </SliderTrack>
          </Slider>
        </div>
        <div class="flex flex-col gap-10">
          <div class="flex items-center justify-between gap-12">
            <label class="text-13 text-text-primary" for="settings-appearance-hue">
              Hue
            </label>
            <span class="text-12 text-text-muted">{`${props.washHueDeg}°`}</span>
          </div>
          <Slider
            id="settings-appearance-hue"
            minValue={props.washHueMin ?? 0}
            maxValue={props.washHueMax ?? 360}
            step={1}
            value={[props.washHueDeg]}
            onChange={(values) => props.onWashHueChange(values[0] ?? props.washHueDeg)}
          >
            <SliderTrack>
              <SliderFill />
              <SliderThumb aria-label="Hue" />
            </SliderTrack>
          </Slider>
        </div>
      </div>
      ) : null}
    </div>
  );
};
