/**
 * AppShell 侧栏宽度契约：拖拽调整与网格列宽计算。
 *
 * 已知缺口（后续迭代）：
 * - 折叠为 0px 时 ProjectDrawer `overflow-hidden` 会裁切 SidebarRail，需依赖 Cmd/Ctrl+B 或 Chat 导航恢复。
 * - 移动端仍用 ProjectDrawer 的 `open` 信号，未接入 SidebarProvider.openMobile。
 * - ResourceFloatingPanel 仍用自研拖拽，未迁移至 @peri/ui ResizablePanel（绝对定位 + leftOffset 契约不兼容）。
 */

export const SHELL_SIDEBAR_MIN_WIDTH = 220;
export const SHELL_SIDEBAR_MAX_WIDTH = 480;
export const SHELL_SIDEBAR_DEFAULT_WIDTH = 242;
export const SHELL_SIDEBAR_KEYBOARD_STEP = 24;

export function clampShellSidebarWidth(width: number) {
  return Math.min(SHELL_SIDEBAR_MAX_WIDTH, Math.max(SHELL_SIDEBAR_MIN_WIDTH, width));
}

/** 桌面网格侧栏列宽；折叠时为 0（由 Cmd/Ctrl+B 或 SidebarRail 恢复）。 */
export function shellSidebarColumnWidth(open: boolean, width: number) {
  return open ? width : 0;
}
