import {
  workbenchFloatingPanelLeftClass,
  workbenchFloatingPanelRightClass,
} from '@peri/ui';

export {
  WORKBENCH_PANEL_DEFAULT_WIDTH,
  WORKBENCH_PANEL_EDGE_INSET,
  WORKBENCH_PANEL_GRAPH_DEFAULT_WIDTH,
  WORKBENCH_PANEL_GRAPH_MAX_WIDTH,
  WORKBENCH_PANEL_GRAPH_MIN_WIDTH,
  WORKBENCH_PANEL_GRAPH_WIDTH_STORAGE_KEY,
  WORKBENCH_PANEL_KEYBOARD_STEP,
  WORKBENCH_PANEL_MAX_WIDTH,
  WORKBENCH_PANEL_MIN_WIDTH,
  WORKBENCH_PANEL_PREVIEW_DEFAULT_WIDTH,
  WORKBENCH_PANEL_PREVIEW_MAX_WIDTH,
  WORKBENCH_PANEL_PREVIEW_MIN_WIDTH,
  WORKBENCH_PANEL_PREVIEW_WIDTH_STORAGE_KEY,
  WORKBENCH_PANEL_TERMINAL_DEFAULT_WIDTH,
  WORKBENCH_PANEL_TERMINAL_MAX_WIDTH,
  WORKBENCH_PANEL_TERMINAL_MIN_WIDTH,
  WORKBENCH_PANEL_TERMINAL_WIDTH_STORAGE_KEY,
  WORKBENCH_PANEL_WIDTH_STORAGE_KEY,
  clampWorkbenchPanelWidth,
  persistWorkbenchPanelWidth,
  readStoredWorkbenchPanelWidth,
  workbenchFilePreviewLeftOffset,
  workbenchPanelWidthLimits,
  type WorkbenchPanelWidthLimits,
  type WorkbenchPanelWidthProfile,
} from '@peri/ui';

/** 固定 token 宽度的浮动壳（如 Rewind）。 */
export const RESOURCE_PANEL_SURFACE_CLASS = 'inset-y-8 right-52 w-(--workbench-panel-width) overflow-hidden rounded-14 border border-border-subtle bg-surface-overlay shadow-overlay wide:w-(--workbench-panel-width-wide)';

/** @deprecated 使用 `WorkbenchFloatingPanel`；保留 Rewind 等固定壳契约。 */
export const RESOURCE_PANEL_FLOATING_SHELL_CLASS = workbenchFloatingPanelRightClass;

/** @deprecated 使用 `WorkbenchFloatingPanel` anchor=left。 */
export const RESOURCE_PANEL_FLOATING_SHELL_LEFT_CLASS = workbenchFloatingPanelLeftClass;

export { workbenchPanelChromeHeaderClass as RESOURCE_PANEL_HEADER_CLASS, workbenchPanelChromeTitleClass as RESOURCE_PANEL_TITLE_CLASS } from '@peri/ui';
