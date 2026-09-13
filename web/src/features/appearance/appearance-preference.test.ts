import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_MATERIALS,
  DEFAULT_APPEARANCE_PREFERENCE,
  DEFAULT_WASH_BLUR_PX,
  DEFAULT_WASH_HUE_DEG,
  appearanceStorageKey,
  applyAppearancePreference,
  clampAppearanceFill,
  clampAppearanceWashBlur,
  clampAppearanceWashHue,
  normalizeAppearancePreference,
  readAppearancePreference,
  writeAppearancePreference,
} from './appearance-preference';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe('appearance preference', () => {
  it('defaults to None at 100% fill with light wash blur and hue shift', () => {
    expect(DEFAULT_APPEARANCE_PREFERENCE).toEqual({
      materialId: 'none',
      fillPercent: 100,
      washBlurPx: DEFAULT_WASH_BLUR_PX,
      washHueDeg: DEFAULT_WASH_HUE_DEG,
    });
    expect(APPEARANCE_MATERIALS.map((item) => item.id)).toEqual([
      'none',
      'clouds',
      'marble',
      'silk',
      'linen',
      'paper',
    ]);
  });

  it('normalizes unknown material and out-of-range fill and blur', () => {
    expect(normalizeAppearancePreference({
      materialId: 'obsidian',
      fillPercent: 140,
      washBlurPx: 99,
      washHueDeg: 420,
    })).toEqual({
      materialId: 'none',
      fillPercent: 100,
      washBlurPx: 24,
      washHueDeg: 360,
    });
    expect(clampAppearanceFill(-8)).toBe(0);
    expect(clampAppearanceWashBlur(-4)).toBe(0);
    expect(clampAppearanceWashBlur(18.6)).toBe(19);
    expect(clampAppearanceWashHue(-12)).toBe(0);
    expect(clampAppearanceWashHue(400)).toBe(360);
  });

  it('persists per principal and applies CSS variables', () => {
    const storage = new MemoryStorage();
    const written = writeAppearancePreference(
      'principal-1',
      { materialId: 'silk', fillPercent: 32, washBlurPx: 8, washHueDeg: 120 },
      storage,
    );
    expect(written).toEqual({ materialId: 'silk', fillPercent: 32, washBlurPx: 8, washHueDeg: 120 });
    expect(readAppearancePreference('principal-1', storage)).toEqual(written);
    expect(readAppearancePreference(null, storage)).toEqual(DEFAULT_APPEARANCE_PREFERENCE);
    expect(storage.getItem(appearanceStorageKey('principal-1'))).toContain('silk');

    const vars = new Map<string, string>();
    applyAppearancePreference(written, {
      style: { setProperty: (name, value) => { vars.set(name, value); } },
    });
    expect(vars.get('--sidebar-frost-wash')).toBe('url("/images/sidebar-frost-silk.png")');
    expect(vars.get('--sidebar-frost-fill')).toBe('32%');
    expect(vars.get('--sidebar-frost-wash-blur')).toBe('8px');
    expect(vars.get('--sidebar-frost-wash-hue')).toBe('120deg');
    expect(vars.get('--sidebar-frost-grain-opacity')).toBe('0.07');
  });

  it('applies solid sidebar when None is selected', () => {
    const vars = new Map<string, string>();
    applyAppearancePreference(DEFAULT_APPEARANCE_PREFERENCE, {
      style: { setProperty: (name, value) => { vars.set(name, value); } },
    });
    expect(vars.get('--sidebar-frost-wash')).toBe('none');
    expect(vars.get('--sidebar-frost-fill')).toBe('100%');
    expect(vars.get('--sidebar-frost-grain-opacity')).toBe('0');
    expect(vars.has('--sidebar-frost-wash-blur')).toBe(false);
  });

  it('uses an origin-level key when no principal is signed in', () => {
    const storage = new MemoryStorage();
    writeAppearancePreference(null, { materialId: 'paper', fillPercent: 20, washBlurPx: 16, washHueDeg: 45 }, storage);
    expect(readAppearancePreference(null, storage)).toEqual({
      materialId: 'paper',
      fillPercent: 20,
      washBlurPx: 16,
      washHueDeg: 45,
    });
    expect(storage.getItem(appearanceStorageKey(null))).toContain('paper');
  });
});
