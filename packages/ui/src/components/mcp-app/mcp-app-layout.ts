/** MCP App inline 高度缺省与上限（像素；与 tokens 刻度一致）。 */
export const MCP_APP_DEFAULT_HEIGHT = 400;
export const MCP_APP_MAX_HEIGHT = 720;
export const MCP_APP_MAX_WIDTH = 720;

export const MCP_APPS_PROTOCOL = '2026-01-26';
export const MCP_APP_HOST_VERSION = '0.2.0';
export const MCP_APP_HOST_NAME = 'peri-studio';

export function mcpAppInlineMaxHeight(): number {
  if (typeof window === 'undefined') return MCP_APP_MAX_HEIGHT;
  return Math.min(MCP_APP_MAX_HEIGHT, Math.max(MCP_APP_DEFAULT_HEIGHT, Math.round(window.innerHeight * 0.7)));
}
