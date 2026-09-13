import { createEffect, createMemo, createSignal } from 'solid-js';
import { Palette } from 'lucide-solid';
import { SettingsAppearancePane, SettingsPanel } from '@peri/ui';
import { principalId } from '@/features/auth/auth-state';
import {
  APPEARANCE_MATERIALS,
  MAX_WASH_BLUR_PX,
  MAX_WASH_HUE_DEG,
  MIN_WASH_BLUR_PX,
  MIN_WASH_HUE_DEG,
  applyAppearancePreference,
  readAppearancePreference,
  writeAppearancePreference,
  type AppearancePreference,
} from '@/features/appearance/appearance-preference';

const NAV_ITEMS = [
  { id: 'appearance', label: 'Appearance', icon: <Palette size={16} strokeWidth={1.7} /> },
];

/** T4 · 齿轮 Settings 面板：装配 Appearance 偏好。 */
export function AppSettingsPanel(props: { open: boolean; onClose: () => void }) {
  const [section, setSection] = createSignal('appearance');
  const [preference, setPreference] = createSignal<AppearancePreference>(
    readAppearancePreference(principalId()),
  );

  createEffect(() => {
    const next = readAppearancePreference(principalId());
    setPreference(next);
    applyAppearancePreference(next);
  });

  const commit = (next: AppearancePreference) => {
    const stored = writeAppearancePreference(principalId(), next);
    setPreference(stored);
    applyAppearancePreference(stored);
  };

  const materials = createMemo(() => APPEARANCE_MATERIALS.map((item) => ({
    id: item.id,
    label: item.label,
    previewSrc: item.washUrl,
  })));

  return (
    <SettingsPanel
      open={props.open}
      onOpenChange={(open) => { if (!open) props.onClose(); }}
      title="Settings"
      items={NAV_ITEMS}
      selectedId={section()}
      onSelect={setSection}
    >
      <SettingsAppearancePane
        materials={materials()}
        selectedId={preference().materialId}
        onSelect={(id) => commit({ ...preference(), materialId: id as AppearancePreference['materialId'] })}
        fillPercent={preference().fillPercent}
        onFillChange={(fillPercent) => commit({ ...preference(), fillPercent })}
        washBlurPx={preference().washBlurPx}
        onWashBlurChange={(washBlurPx) => commit({ ...preference(), washBlurPx })}
        washBlurMin={MIN_WASH_BLUR_PX}
        washBlurMax={MAX_WASH_BLUR_PX}
        washHueDeg={preference().washHueDeg}
        onWashHueChange={(washHueDeg) => commit({ ...preference(), washHueDeg })}
        washHueMin={MIN_WASH_HUE_DEG}
        washHueMax={MAX_WASH_HUE_DEG}
      />
    </SettingsPanel>
  );
}
