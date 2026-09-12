/** 桌面浮动面板宽度契约（Explorer / SCM / Graph / Preview / Terminal 共用）。 */
export type WorkbenchPanelWidthProfile = 'workspace' | 'graph' | 'preview' | 'terminal';

export const WORKBENCH_PANEL_WIDTH_STORAGE_KEY = 'peri:workbench-panel-width';
export const WORKBENCH_PANEL_GRAPH_WIDTH_STORAGE_KEY = 'peri:workbench-panel-width-graph';
export const WORKBENCH_PANEL_PREVIEW_WIDTH_STORAGE_KEY = 'peri:file-preview-panel-width';
export const WORKBENCH_PANEL_TERMINAL_WIDTH_STORAGE_KEY = 'peri:workbench-panel-width-terminal';

export const WORKBENCH_PANEL_DEFAULT_WIDTH = 264;
export const WORKBENCH_PANEL_MIN_WIDTH = 220;
export const WORKBENCH_PANEL_MAX_WIDTH = 560;

export const WORKBENCH_PANEL_GRAPH_DEFAULT_WIDTH = 480;
export const WORKBENCH_PANEL_GRAPH_MIN_WIDTH = 360;
export const WORKBENCH_PANEL_GRAPH_MAX_WIDTH = 720;

export const WORKBENCH_PANEL_PREVIEW_DEFAULT_WIDTH = 520;
export const WORKBENCH_PANEL_PREVIEW_MIN_WIDTH = 320;
export const WORKBENCH_PANEL_PREVIEW_MAX_WIDTH = 720;

export const WORKBENCH_PANEL_TERMINAL_DEFAULT_WIDTH = 520;
export const WORKBENCH_PANEL_TERMINAL_MIN_WIDTH = 360;
export const WORKBENCH_PANEL_TERMINAL_MAX_WIDTH = 720;

export const WORKBENCH_PANEL_KEYBOARD_STEP = 24;

/** 浮动面板与侧栏 / 视口边缘的水平间距（与 `inset-y-8` 一致）。 */
export const WORKBENCH_PANEL_EDGE_INSET = 8;

export function workbenchFilePreviewLeftOffset(sidebarWidth: number) {
  return sidebarWidth + WORKBENCH_PANEL_EDGE_INSET;
}

export type WorkbenchPanelWidthLimits = {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  storageKey: string;
};

export function workbenchPanelWidthLimits(
  profile: WorkbenchPanelWidthProfile = 'workspace',
): WorkbenchPanelWidthLimits {
  if (profile === 'graph') {
    return {
      defaultWidth: WORKBENCH_PANEL_GRAPH_DEFAULT_WIDTH,
      minWidth: WORKBENCH_PANEL_GRAPH_MIN_WIDTH,
      maxWidth: WORKBENCH_PANEL_GRAPH_MAX_WIDTH,
      storageKey: WORKBENCH_PANEL_GRAPH_WIDTH_STORAGE_KEY,
    };
  }
  if (profile === 'preview') {
    return {
      defaultWidth: WORKBENCH_PANEL_PREVIEW_DEFAULT_WIDTH,
      minWidth: WORKBENCH_PANEL_PREVIEW_MIN_WIDTH,
      maxWidth: WORKBENCH_PANEL_PREVIEW_MAX_WIDTH,
      storageKey: WORKBENCH_PANEL_PREVIEW_WIDTH_STORAGE_KEY,
    };
  }
  if (profile === 'terminal') {
    return {
      defaultWidth: WORKBENCH_PANEL_TERMINAL_DEFAULT_WIDTH,
      minWidth: WORKBENCH_PANEL_TERMINAL_MIN_WIDTH,
      maxWidth: WORKBENCH_PANEL_TERMINAL_MAX_WIDTH,
      storageKey: WORKBENCH_PANEL_TERMINAL_WIDTH_STORAGE_KEY,
    };
  }
  return {
    defaultWidth: WORKBENCH_PANEL_DEFAULT_WIDTH,
    minWidth: WORKBENCH_PANEL_MIN_WIDTH,
    maxWidth: WORKBENCH_PANEL_MAX_WIDTH,
    storageKey: WORKBENCH_PANEL_WIDTH_STORAGE_KEY,
  };
}

export function clampWorkbenchPanelWidth(width: number, profile: WorkbenchPanelWidthProfile = 'workspace') {
  const { minWidth, maxWidth } = workbenchPanelWidthLimits(profile);
  return Math.min(maxWidth, Math.max(minWidth, width));
}

export function readStoredWorkbenchPanelWidth(profile: WorkbenchPanelWidthProfile = 'workspace'): number {
  const { defaultWidth, storageKey } = workbenchPanelWidthLimits(profile);
  if (typeof sessionStorage === 'undefined') return defaultWidth;
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return defaultWidth;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? clampWorkbenchPanelWidth(parsed, profile) : defaultWidth;
}

export function persistWorkbenchPanelWidth(width: number, profile: WorkbenchPanelWidthProfile = 'workspace') {
  if (typeof sessionStorage === 'undefined') return;
  const { storageKey } = workbenchPanelWidthLimits(profile);
  sessionStorage.setItem(storageKey, String(clampWorkbenchPanelWidth(width, profile)));
}
