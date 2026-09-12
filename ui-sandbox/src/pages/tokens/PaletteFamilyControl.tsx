import { createSignal, For, onMount } from 'solid-js';
import { RotateCcw } from 'lucide-solid';
import {
  clearPaletteSeed,
  getPaletteSeed,
  isPaletteSeedCustom,
  PALETTE_FAMILIES,
  paletteTokenName,
  setPaletteSeed,
  subscribePaletteEditor,
  type PaletteFamilyConfig,
} from '@/lib/palette-scale';
import { IconButton } from '@/lib/catalog-ui';

export function PaletteFamilyControl(props: { config: PaletteFamilyConfig }) {
  const [tick, setTick] = createSignal(0);

  onMount(() => subscribePaletteEditor(() => setTick((value) => value + 1)));

  const seed = () => {
    tick();
    return getPaletteSeed(props.config.family);
  };

  const custom = () => {
    tick();
    return isPaletteSeedCustom(props.config.family);
  };

  return (
    <div class="palette-scale-row" classList={{ 'palette-scale-row--custom': custom() }}>
      <div class="flex items-center justify-between gap-8">
        <div class="min-w-0">
          <div class="text-12 font-medium text-content-primary">{props.config.label}</div>
          <div class="text-10 text-content-muted">
            种子色 · anchor {props.config.anchorStep} · OKLCH 阶梯自动计算
          </div>
        </div>
        <div class="flex items-center gap-6">
          <input
            type="color"
            class="token-control-color-input"
            value={seed()}
            aria-label={`${props.config.label} seed color`}
            onInput={(event) => setPaletteSeed(props.config.family, event.currentTarget.value)}
          />
          <IconButton
            label={`Reset ${props.config.label} palette`}
            size="sm"
            disabled={!custom()}
            onClick={() => clearPaletteSeed(props.config.family)}
          >
            <RotateCcw size={14} />
          </IconButton>
        </div>
      </div>
      <div class="palette-scale-strip" role="list" aria-label={`${props.config.label} scale`}>
        <For each={props.config.steps}>
          {(step) => (
            <div
              class="palette-scale-chip"
              classList={{ 'palette-scale-chip--anchor': step === props.config.anchorStep }}
              style={{ background: `var(${paletteTokenName(props.config.family, step)})` }}
              title={`${step}`}
              role="listitem"
            >
              <span class="palette-scale-chip__label">{step}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export function PaletteFamilyControls() {
  return (
    <div class="mb-20 flex flex-col gap-12">
      <For each={PALETTE_FAMILIES}>{(config) => <PaletteFamilyControl config={config} />}</For>
    </div>
  );
}
