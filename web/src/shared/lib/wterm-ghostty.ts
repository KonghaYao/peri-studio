import { GhosttyCore, type GhosttyOptions } from '@wterm/ghostty';
import ghosttyWasmUrl from '@wterm/ghostty/ghostty-vt.wasm?url';

/** 从 tokens 读取终端前景/背景，供 Ghostty OSC 10/11 与渲染一致。 */
export function readTerminalThemeColors(): Pick<GhosttyOptions, 'foregroundColor' | 'backgroundColor'> {
  const style = getComputedStyle(document.documentElement);
  const foreground = style.getPropertyValue('--terminal-viewport-fg').trim() || '#f0f0f0';
  const background = style.getPropertyValue('--terminal-viewport-bg').trim() || '#141414';
  return { foregroundColor: foreground, backgroundColor: background };
}

/** 每个 WTerm 实例需要独立的 GhosttyCore（共享 WASM 加载，独立 VT 状态）。 */
export async function createGhosttyCore(
  overrides: Partial<GhosttyOptions> = {},
): Promise<GhosttyCore> {
  const theme = readTerminalThemeColors();
  return GhosttyCore.load({
    wasmPath: ghosttyWasmUrl,
    scrollbackLimit: 512_000,
    imageStorageLimit: 32 * 1024 * 1024,
    ...theme,
    ...overrides,
  });
}
