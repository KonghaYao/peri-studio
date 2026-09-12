/* 调色板阶梯：由种子色在 OKLCH 空间按 Tailwind 亮度曲线推导，写入 --palette-*。 */

import { readDesignTokens } from '@/lib/token-reader';

const STORAGE_KEY = 'peri-sandbox-palette-seeds';

export type PaletteFamily = 'accent' | 'neutral' | 'success' | 'warning' | 'danger';

export interface PaletteFamilyConfig {
  family: PaletteFamily;
  label: string;
  anchorStep: number;
  steps: number[];
  /** 中性灰阶：只调亮度，色度归零。 */
  neutral: boolean;
}

/** Tailwind v4 默认亮度曲线（OKLCH L 0–1）。 */
const TAILWIND_LIGHTNESS: Record<number, number> = {
  0: 1,
  25: 0.985,
  50: 0.97,
  100: 0.93,
  200: 0.88,
  300: 0.81,
  400: 0.69,
  500: 0.55,
  600: 0.48,
  700: 0.42,
  800: 0.35,
  900: 0.27,
  950: 0.18,
};

export const PALETTE_FAMILIES: PaletteFamilyConfig[] = [
  {
    family: 'accent',
    label: 'Accent',
    anchorStep: 600,
    steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900],
    neutral: false,
  },
  {
    family: 'neutral',
    label: 'Neutral',
    anchorStep: 500,
    steps: [0, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950],
    neutral: true,
  },
  {
    family: 'success',
    label: 'Success',
    anchorStep: 500,
    steps: [50, 100, 200, 500, 600, 700],
    neutral: false,
  },
  {
    family: 'warning',
    label: 'Warning',
    anchorStep: 500,
    steps: [50, 100, 200, 500, 600, 700],
    neutral: false,
  },
  {
    family: 'danger',
    label: 'Danger',
    anchorStep: 500,
    steps: [50, 100, 200, 500, 600, 700],
    neutral: false,
  },
];

const seeds = new Map<PaletteFamily, string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribePaletteEditor(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isPaletteToken(name: string): boolean {
  return /^--palette-[a-z]+-\d+$/.test(name);
}

export function paletteTokenName(family: PaletteFamily, step: number): string {
  return `--palette-${family}-${step}`;
}

function readPersistedSeeds(): Partial<Record<PaletteFamily, string>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<Record<PaletteFamily, string>>;
  } catch {
    return {};
  }
}

function persistSeeds(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(seeds.entries())));
  } catch {
    // ignore
  }
}

let defaultTokens: Map<string, string> | null = null;

function tokenDefault(name: string): string {
  if (!defaultTokens) {
    defaultTokens = new Map(readDesignTokens().map((entry) => [entry.name, entry.value]));
  }
  return defaultTokens.get(name) ?? '';
}

function defaultSeedHex(family: PaletteFamily, anchorStep: number): string {
  const fromToken = tokenDefault(paletteTokenName(family, anchorStep));
  if (/^#[0-9a-f]{6}$/i.test(fromToken)) return fromToken.toLowerCase();
  return '#808080';
}

export function getPaletteSeed(family: PaletteFamily): string {
  const config = PALETTE_FAMILIES.find((item) => item.family === family)!;
  return seeds.get(family) ?? defaultSeedHex(family, config.anchorStep);
}

export function isPaletteSeedCustom(family: PaletteFamily): boolean {
  return seeds.has(family);
}

type Oklch = { l: number; c: number; h: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  const value = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return clamp(Math.round(value * 255), 0, 255);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function rgbToOklch(r: number, g: number, b: number): Oklch {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  const L = 0.2104542553 * lRoot + 0.7936177850 * mRoot - 0.0040720468 * sRoot;
  const a = 1.9779984951 * lRoot - 2.4285922050 * mRoot + 0.4505937099 * sRoot;
  const b2 = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.8086757660 * sRoot;

  const c = Math.sqrt(a * a + b2 * b2);
  let h = Math.atan2(b2, a) * (180 / Math.PI);
  if (h < 0) h += 360;
  if (Number.isNaN(h)) h = 0;

  return { l: L, c, h };
}

function oklchToRgb(l: number, c: number, h: number): { r: number; g: number; b: number } {
  const hueRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hueRad);
  const b2 = c * Math.sin(hueRad);

  const lRoot = l + 0.3963377774 * a + 0.2158037573 * b2;
  const mRoot = l - 0.1055613458 * a - 0.0638541728 * b2;
  const sRoot = l - 0.0894841775 * a - 1.2914855480 * b2;

  const lLin = lRoot ** 3;
  const mLin = mRoot ** 3;
  const sLin = sRoot ** 3;

  const lr = 4.0767416621 * lLin - 3.3077115913 * mLin + 0.2309699292 * sLin;
  const lg = -1.2684380046 * lLin + 2.6097574011 * mLin - 0.3413193965 * sLin;
  const lb = -0.0041960863 * lLin - 0.7034186147 * mLin + 1.7076147010 * sLin;

  return {
    r: linearToSrgb(lr),
    g: linearToSrgb(lg),
    b: linearToSrgb(lb),
  };
}

function chromaForStep(step: number, baseChroma: number): number {
  if (step <= 50) return baseChroma * 0.18;
  if (step <= 100) return baseChroma * 0.28;
  if (step <= 200) return baseChroma * 0.45;
  if (step <= 300) return baseChroma * 0.65;
  if (step <= 400) return baseChroma * 0.85;
  return baseChroma;
}

export function generatePaletteScale(family: PaletteFamily, seedHex: string): Record<string, string> {
  const config = PALETTE_FAMILIES.find((item) => item.family === family)!;
  const normalized = seedHex.trim().toLowerCase();
  const { r, g, b } = hexToRgb(normalized);
  const base = rgbToOklch(r, g, b);
  const anchorCurveL = TAILWIND_LIGHTNESS[config.anchorStep] ?? base.l;

  const output: Record<string, string> = {};
  for (const step of config.steps) {
    if (step === 0) {
      output[paletteTokenName(family, step)] = '#ffffff';
      continue;
    }

    if (step === config.anchorStep) {
      output[paletteTokenName(family, step)] = normalized;
      continue;
    }

    const stepCurveL = TAILWIND_LIGHTNESS[step] ?? base.l;
    const scale = anchorCurveL > 0 ? stepCurveL / anchorCurveL : 1;
    const l = clamp(base.l * scale, 0, 1);
    const c = config.neutral ? 0 : chromaForStep(step, base.c);
    const { r: nr, g: ng, b: nb } = oklchToRgb(l, c, base.h);
    output[paletteTokenName(family, step)] = rgbToHex(nr, ng, nb);
  }

  return output;
}

function applyScaleToDocument(scale: Record<string, string>): void {
  for (const [name, value] of Object.entries(scale)) {
    document.documentElement.style.setProperty(name, value);
  }
}

function clearScaleFromDocument(family: PaletteFamily): void {
  const config = PALETTE_FAMILIES.find((item) => item.family === family)!;
  for (const step of config.steps) {
    document.documentElement.style.removeProperty(paletteTokenName(family, step));
  }
}

export function setPaletteSeed(family: PaletteFamily, seedHex: string): void {
  const normalized = seedHex.trim().toLowerCase();
  const config = PALETTE_FAMILIES.find((item) => item.family === family)!;
  const defaultSeed = defaultSeedHex(family, config.anchorStep);

  if (normalized === defaultSeed) {
    clearPaletteSeed(family);
    return;
  }

  seeds.set(family, normalized);
  applyScaleToDocument(generatePaletteScale(family, normalized));
  persistSeeds();
  notify();
}

export function clearPaletteSeed(family: PaletteFamily): void {
  seeds.delete(family);
  clearScaleFromDocument(family);
  persistSeeds();
  notify();
}

export function clearAllPaletteSeeds(): void {
  for (const config of PALETTE_FAMILIES) {
    clearScaleFromDocument(config.family);
  }
  seeds.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  notify();
}

export function bootstrapPaletteScales(): void {
  const persisted = readPersistedSeeds();
  for (const config of PALETTE_FAMILIES) {
    const seed = persisted[config.family];
    if (seed) {
      seeds.set(config.family, seed);
      applyScaleToDocument(generatePaletteScale(config.family, seed));
    }
  }
}

export function exportPaletteCss(): string {
  if (seeds.size === 0) return '';
  const lines: string[] = ['  /* Palette seeds (OKLCH / Tailwind lightness curve) */'];
  for (const [family, seed] of seeds.entries()) {
    lines.push(`  /* ${family} seed: ${seed} */`);
    const scale = generatePaletteScale(family, seed);
    for (const [name, value] of Object.entries(scale)) {
      lines.push(`  ${name}: ${value};`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function paletteSeedCount(): number {
  return seeds.size;
}
