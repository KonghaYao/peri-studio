// 侧栏 Appearance 偏好：材质 wash + fill 透明度。纯 TS，不 import store。

export const APPEARANCE_MATERIAL_IDS = ['clouds', 'marble', 'silk', 'linen', 'paper'] as const;

export type AppearanceMaterialId = (typeof APPEARANCE_MATERIAL_IDS)[number];

export type AppearanceMaterial = {
  id: AppearanceMaterialId;
  label: string;
  washUrl: string;
};

export type AppearancePreference = {
  materialId: AppearanceMaterialId;
  fillPercent: number;
  washBlurPx: number;
  washHueDeg: number;
};

export interface AppearanceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const APPEARANCE_MATERIALS: readonly AppearanceMaterial[] = [
  { id: 'clouds', label: 'Clouds', washUrl: '/images/sidebar-frost-wash.png' },
  { id: 'marble', label: 'Marble', washUrl: '/images/sidebar-frost-marble.png' },
  { id: 'silk', label: 'Silk', washUrl: '/images/sidebar-frost-silk.png' },
  { id: 'linen', label: 'Linen', washUrl: '/images/sidebar-frost-linen.png' },
  { id: 'paper', label: 'Paper', washUrl: '/images/sidebar-frost-paper.png' },
];

export const DEFAULT_WASH_BLUR_PX = 1;
export const MIN_WASH_BLUR_PX = 0;
export const MAX_WASH_BLUR_PX = 24;

export const DEFAULT_WASH_HUE_DEG = 162;
export const MIN_WASH_HUE_DEG = 0;
export const MAX_WASH_HUE_DEG = 360;

export const DEFAULT_APPEARANCE_PREFERENCE: AppearancePreference = {
  materialId: 'linen',
  fillPercent: 10,
  washBlurPx: DEFAULT_WASH_BLUR_PX,
  washHueDeg: DEFAULT_WASH_HUE_DEG,
};

const ORIGIN_STORAGE_KEY = 'peri_studio:appearance';

export const appearanceStorageKey = (principalId: string | null): string => (
  principalId ? `${ORIGIN_STORAGE_KEY}:${encodeURIComponent(principalId)}` : ORIGIN_STORAGE_KEY
);

const browserStorage = (): AppearanceStorage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const isMaterialId = (value: unknown): value is AppearanceMaterialId => (
  typeof value === 'string' && (APPEARANCE_MATERIAL_IDS as readonly string[]).includes(value)
);

export const appearanceMaterialById = (id: AppearanceMaterialId): AppearanceMaterial => (
  APPEARANCE_MATERIALS.find((item) => item.id === id) ?? APPEARANCE_MATERIALS[0]
);

export const clampAppearanceFill = (value: number): number => (
  Math.min(100, Math.max(0, Math.round(value)))
);

export const clampAppearanceWashBlur = (value: number): number => (
  Math.min(MAX_WASH_BLUR_PX, Math.max(MIN_WASH_BLUR_PX, Math.round(value)))
);

export const clampAppearanceWashHue = (value: number): number => (
  Math.min(MAX_WASH_HUE_DEG, Math.max(MIN_WASH_HUE_DEG, Math.round(value)))
);

export const normalizeAppearancePreference = (value: unknown): AppearancePreference => {
  if (!value || typeof value !== 'object') return { ...DEFAULT_APPEARANCE_PREFERENCE };
  const candidate = value as {
    materialId?: unknown;
    fillPercent?: unknown;
    washBlurPx?: unknown;
    washHueDeg?: unknown;
  };
  return {
    materialId: isMaterialId(candidate.materialId) ? candidate.materialId : DEFAULT_APPEARANCE_PREFERENCE.materialId,
    fillPercent: typeof candidate.fillPercent === 'number' && Number.isFinite(candidate.fillPercent)
      ? clampAppearanceFill(candidate.fillPercent)
      : DEFAULT_APPEARANCE_PREFERENCE.fillPercent,
    washBlurPx: typeof candidate.washBlurPx === 'number' && Number.isFinite(candidate.washBlurPx)
      ? clampAppearanceWashBlur(candidate.washBlurPx)
      : DEFAULT_APPEARANCE_PREFERENCE.washBlurPx,
    washHueDeg: typeof candidate.washHueDeg === 'number' && Number.isFinite(candidate.washHueDeg)
      ? clampAppearanceWashHue(candidate.washHueDeg)
      : DEFAULT_APPEARANCE_PREFERENCE.washHueDeg,
  };
};

export const readAppearancePreference = (
  principalId: string | null,
  storage: AppearanceStorage | null | undefined = undefined,
): AppearancePreference => {
  const source = storage === undefined ? browserStorage() : storage;
  if (!source) return { ...DEFAULT_APPEARANCE_PREFERENCE };
  try {
    const raw = source.getItem(appearanceStorageKey(principalId));
    return raw ? normalizeAppearancePreference(JSON.parse(raw)) : { ...DEFAULT_APPEARANCE_PREFERENCE };
  } catch {
    return { ...DEFAULT_APPEARANCE_PREFERENCE };
  }
};

export const writeAppearancePreference = (
  principalId: string | null,
  preference: AppearancePreference,
  storage: AppearanceStorage | null | undefined = undefined,
): AppearancePreference => {
  const next = normalizeAppearancePreference(preference);
  const target = storage === undefined ? browserStorage() : storage;
  if (!target) return next;
  try {
    target.setItem(appearanceStorageKey(principalId), JSON.stringify(next));
  } catch {
    // 本地偏好不可用时仍返回规范化结果，供当前页内存态使用。
  }
  return next;
};

export const applyAppearancePreference = (
  preference: AppearancePreference,
  target: { style: { setProperty: (name: string, value: string) => void } } | null | undefined = undefined,
): void => {
  if (typeof document === 'undefined' && !target) return;
  const root = target ?? document.documentElement;
  const next = normalizeAppearancePreference(preference);
  const material = appearanceMaterialById(next.materialId);
  root.style.setProperty('--sidebar-frost-wash', `url("${material.washUrl}")`);
  root.style.setProperty('--sidebar-frost-fill', `${next.fillPercent}%`);
  root.style.setProperty('--sidebar-frost-wash-blur', `${next.washBlurPx}px`);
  root.style.setProperty('--sidebar-frost-wash-hue', `${next.washHueDeg}deg`);
};
