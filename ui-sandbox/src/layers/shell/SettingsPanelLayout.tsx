import { createSignal } from 'solid-js';
import { Palette } from 'lucide-solid';
import { Button, SettingsAppearancePane, SettingsPanel } from '@peri/ui';

const MATERIALS = [
  { id: 'clouds', label: 'Clouds', previewSrc: '/images/sidebar-frost-wash.png' },
  { id: 'marble', label: 'Marble', previewSrc: '/images/sidebar-frost-marble.png' },
  { id: 'silk', label: 'Silk', previewSrc: '/images/sidebar-frost-silk.png' },
  { id: 'linen', label: 'Linen', previewSrc: '/images/sidebar-frost-linen.png' },
  { id: 'paper', label: 'Paper', previewSrc: '/images/sidebar-frost-paper.png' },
];

/** Catalog · macOS 式 Settings 分栏 + Appearance 材质演示。 */
export function SettingsPanelLayout() {
  const [open, setOpen] = createSignal(false);
  const [section, setSection] = createSignal('appearance');
  const [materialId, setMaterialId] = createSignal('linen');
  const [fillPercent, setFillPercent] = createSignal(10);
  const [washBlurPx, setWashBlurPx] = createSignal(1);
  const [washHueDeg, setWashHueDeg] = createSignal(162);

  return (
    <div class="flex flex-col items-start gap-12">
      <Button variant="default" onClick={() => setOpen(true)}>
        Open Settings
      </Button>
      <SettingsPanel
        open={open()}
        onOpenChange={setOpen}
        title="Settings"
        items={[{ id: 'appearance', label: 'Appearance', icon: <Palette size={16} strokeWidth={1.7} /> }]}
        selectedId={section()}
        onSelect={setSection}
      >
        <SettingsAppearancePane
          materials={MATERIALS}
          selectedId={materialId()}
          onSelect={setMaterialId}
          fillPercent={fillPercent()}
          onFillChange={setFillPercent}
          washBlurPx={washBlurPx()}
          onWashBlurChange={setWashBlurPx}
          washHueDeg={washHueDeg()}
          onWashHueChange={setWashHueDeg}
        />
      </SettingsPanel>
    </div>
  );
}
