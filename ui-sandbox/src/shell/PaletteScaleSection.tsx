import { For, Show } from 'solid-js';
import { PALETTE_FAMILIES } from '@/lib/palette-scale';
import { PaletteFamilyControl } from '@/pages/tokens/PaletteFamilyControl';

export function PaletteScaleSection(props: { collapsed: boolean; onToggle: () => void }) {
  return (
    <section class="border-b border-border-subtle">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-8 px-10 py-8 text-left transition-colors hover:bg-interaction-hover"
        onClick={props.onToggle}
      >
        <span class="text-11 font-semibold text-content-secondary">Color palettes (computed)</span>
        <span class="text-10 text-content-muted">{PALETTE_FAMILIES.length} families</span>
      </button>
      <Show when={!props.collapsed}>
        <div class="border-t border-border-faint px-10 py-10">
          <p class="mb-10 text-10 leading-normal text-content-muted">
            仅调整种子色；阶梯由 OKLCH 亮度曲线（Tailwind 刻度）自动推导，写入 <code class="text-content-secondary">--palette-*</code>。
          </p>
          <div class="flex flex-col gap-12">
            <For each={PALETTE_FAMILIES}>
              {(config) => <PaletteFamilyControl config={config} />}
            </For>
          </div>
        </div>
      </Show>
    </section>
  );
}
