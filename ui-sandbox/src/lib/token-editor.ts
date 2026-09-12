/* 沙箱 token 运行时覆写：通过 :root inline style 操控全局 CSS 变量，支持持久化与导出。 */

import { isBasicsPanelToken } from '@/lib/token-basics';
import {
  clearAllPaletteSeeds,
  exportPaletteCss,
  isPaletteToken,
  paletteSeedCount,
} from '@/lib/palette-scale';
import { readDesignTokens, resolveToken, type TokenEntry } from '@/lib/token-reader';

const LEGACY_TEXT_COLOR_TOKENS = new Set([
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--text-faint',
]);

const STORAGE_KEY = 'peri-sandbox-token-overrides';

export type TokenInputKind = 'color' | 'text';

export interface TokenGroup {
  id: string;
  label: string;
  entries: TokenEntry[];
}

const overrides = new Map<string, string>();
const listeners = new Set<() => void>();
let defaults: Map<string, string> | null = null;

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

/** 订阅覆写变更（用于面板计数等轻量刷新，避免整树重渲染）。 */
export function subscribeTokenEditor(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function ensureDefaults(): Map<string, string> {
  if (!defaults) {
    defaults = new Map(readDesignTokens().map((entry) => [entry.name, entry.value]));
  }
  return defaults;
}

function persistOverrides(): void {
  const payload = Object.fromEntries([...overrides.entries()].filter(([name]) => !isPaletteToken(name)));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 忽略隐私模式或配额错误
  }
}

function readPersistedOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 启动时恢复上次覆写。 */
export function bootstrapTokenOverrides(): void {
  const persisted = readPersistedOverrides();
  for (const [name, value] of Object.entries(persisted)) {
    if (isPaletteToken(name)) continue;
    overrides.set(name, value);
    document.documentElement.style.setProperty(name, value);
  }
}

export function getTokenOverrides(): ReadonlyMap<string, string> {
  return overrides;
}

export function getTokenDefault(name: string): string {
  return ensureDefaults().get(name) ?? '';
}

export function getTokenValue(name: string): string {
  return overrides.get(name) ?? ensureDefaults().get(name) ?? '';
}

export function isTokenOverridden(name: string): boolean {
  return overrides.has(name);
}

export function setTokenOverride(name: string, value: string): void {
  if (isPaletteToken(name)) return;
  const trimmed = value.trim();
  if (!trimmed || trimmed === getTokenDefault(name)) {
    clearTokenOverride(name);
    return;
  }
  overrides.set(name, trimmed);
  document.documentElement.style.setProperty(name, trimmed);
  persistOverrides();
  notifyListeners();
}

export function clearTokenOverride(name: string): void {
  overrides.delete(name);
  document.documentElement.style.removeProperty(name);
  persistOverrides();
  notifyListeners();
}

export function clearAllTokenOverrides(): void {
  for (const name of overrides.keys()) {
    document.documentElement.style.removeProperty(name);
  }
  overrides.clear();
  clearAllPaletteSeeds();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  notifyListeners();
}

export function exportOverridesCss(): string {
  const paletteBlock = exportPaletteCss();
  const manualLines = [...overrides.entries()]
    .filter(([name]) => !isPaletteToken(name))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `  ${name}: ${value};`);

  if (!paletteBlock && manualLines.length === 0) {
    return ':root {\n  /* no overrides */\n}\n';
  }

  const body = [paletteBlock.trimEnd(), ...manualLines].filter(Boolean).join('\n');
  return `:root {\n${body}\n}\n`;
}

export function getOverrideCount(): number {
  return overrides.size + paletteSeedCount();
}

const COLOR_VALUE_RE = /^(#([0-9a-f]{3,8})|(rgb|hsl|hwb)a?\(|color-mix\()/i;

export function inferTokenInputKind(name: string, value: string): TokenInputKind {
  const trimmed = value.trim();
  if (COLOR_VALUE_RE.test(trimmed)) return 'color';
  if (trimmed.startsWith('var(')) {
    const resolved = resolveToken(name, 'color');
    if (resolved && resolved !== 'initial' && resolved !== 'inherit' && resolved !== trimmed) {
      return 'color';
    }
  }
  if (name.includes('color') || name.includes('bg') || name.includes('fg')) return 'color';
  if (
    name.startsWith('--palette-')
    || name.startsWith('--surface-')
    || name.startsWith('--content-')
    || name.startsWith('--border-')
    || name.startsWith('--accent-')
    || name.startsWith('--feedback-')
    || name.startsWith('--selection-')
    || name.startsWith('--interaction-')
    || name.startsWith('--sidebar-')
    || name.startsWith('--scrim')
    || name.startsWith('--divider')
    || name.startsWith('--git-graph-')
    || name.startsWith('--terminal-')
  ) {
    const resolved = resolveToken(name, 'color');
    if (resolved.startsWith('rgb') || resolved.startsWith('#')) return 'color';
  }
  return 'text';
}

export function resolvedColorHex(name: string): string | null {
  const resolved = resolveToken(name, 'color');
  const match = resolved.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!match) return null;
  const hex = [match[1], match[2], match[3]]
    .map((part) => Number(part).toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}

function categoryLabel(name: string): string {
  if (isPaletteToken(name)) return 'Palette (computed)';
  if (isBasicsPanelToken(name)) return 'Basics (curated panel)';
  if (LEGACY_TEXT_COLOR_TOKENS.has(name)) return 'Legacy aliases';
  if (name.startsWith('--space-')) return 'Spacing';
  if (name.startsWith('--radius-')) return 'Radius';
  if (/^--text-\d/.test(name) || /^--text-\d+p/.test(name)) return 'Typography · Size';
  if (/^--text-(caption|body|title|display)$/.test(name)) return 'Typography · Roles';
  if (/^--leading-(tight|snug|compact|normal|relaxed)$/.test(name)) return 'Typography · Leading roles';
  if (name.startsWith('--leading-')) return 'Typography · Line height';
  if (name.startsWith('--tracking-')) return 'Typography · Letter spacing';
  if (name.startsWith('--font-')) return 'Typography · Font';
  if (name.startsWith('--shadow-') || name.startsWith('--z-') || name.startsWith('--duration-') || name.startsWith('--ease-')) {
    return 'Elevation & motion';
  }
  if (name.startsWith('--grid-') || name.startsWith('--container-')) return 'Layout';
  if (name.startsWith('--surface-') || name === '--scrim') return 'Semantic · Surface';
  if (name.startsWith('--content-')) return 'Semantic · Text';
  if (name.startsWith('--border-') || name === '--divider' || name.startsWith('--sidebar-resize-handle')) return 'Semantic · Border';
  if (name.startsWith('--accent-')) return 'Semantic · Accent';
  if (name.startsWith('--selection-') || name.startsWith('--interaction-')) return 'Semantic · Interaction';
  if (name.startsWith('--feedback-')) return 'Semantic · Feedback';
  if (name.startsWith('--sandbox-')) return 'Shell · Sandbox chrome';
  if (name.startsWith('--shell-')) return 'Component · Shell';
  if (name.startsWith('--sidebar-')) return 'Component · Sidebar';
  if (name.startsWith('--chat-')) return 'Component · Chat';
  if (name.startsWith('--composer-')) return 'Component · Composer';
  if (name.startsWith('--resource-')) return 'Component · Resource';
  if (name.startsWith('--decision-')) return 'Component · Decision';
  if (name.startsWith('--workbench-')) return 'Component · Workbench';
  if (name.startsWith('--status-')) return 'Component · Status';
  if (name.startsWith('--terminal-')) return 'Component · Terminal';
  if (name.startsWith('--control-')) return 'Component · Control';
  if (name.startsWith('--git-graph-')) return 'Component · Git graph';
  if (name.startsWith('--kb-')) return 'Kobalte fallbacks';
  if (
    name.startsWith('--app-')
    || name.startsWith('--link')
    || name.startsWith('--hover')
    || name.startsWith('--selected')
    || name.startsWith('--focus-')
    || name.startsWith('--success')
    || name.startsWith('--warning')
    || name.startsWith('--danger')
    || name.startsWith('--btn-')
    || name.startsWith('--scrollbar-')
    || name === '--accent'
    || name === '--surface'
  ) {
    return 'Legacy aliases';
  }
  return 'Other';
}

const CATEGORY_ORDER = [
  'Semantic · Surface',
  'Semantic · Text',
  'Semantic · Border',
  'Semantic · Accent',
  'Semantic · Interaction',
  'Semantic · Feedback',
  'Spacing',
  'Radius',
  'Typography · Line height',
  'Typography · Letter spacing',
  'Elevation & motion',
  'Layout',
  'Component · Shell',
  'Component · Sidebar',
  'Component · Chat',
  'Component · Composer',
  'Component · Resource',
  'Component · Decision',
  'Component · Workbench',
  'Component · Status',
  'Component · Terminal',
  'Component · Control',
  'Component · Git graph',
  'Legacy aliases',
  'Kobalte fallbacks',
  'Other',
];

export function groupTokensForEditor(entries: TokenEntry[]): TokenGroup[] {
  const buckets = new Map<string, TokenEntry[]>();
  for (const entry of entries) {
    if (isPaletteToken(entry.name) || isBasicsPanelToken(entry.name)) continue;
    const label = categoryLabel(entry.name);
    const list = buckets.get(label) ?? [];
    list.push(entry);
    buckets.set(label, list);
  }

  const groups: TokenGroup[] = [];
  for (const label of CATEGORY_ORDER) {
    const list = buckets.get(label);
    if (!list?.length) continue;
    groups.push({
      id: label.replace(/\s+/g, '-').toLowerCase(),
      label,
      entries: list.sort((left, right) => left.name.localeCompare(right.name)),
    });
    buckets.delete(label);
  }

  for (const [label, list] of buckets.entries()) {
    groups.push({
      id: label.replace(/\s+/g, '-').toLowerCase(),
      label,
      entries: list.sort((left, right) => left.name.localeCompare(right.name)),
    });
  }

  return groups;
}
