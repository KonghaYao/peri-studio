/** Host 绑定所需的 live session 视图（无 store / 协议字段）。 */
export interface McpAppHostSessionView {
  toolCallId: string;
  appSessionId: string;
  html: string | null;
  csp: string | null;
  toolInput: unknown;
  toolResult: unknown;
}

export interface McpAppHostHandle {
  close(): Promise<void>;
}

export type McpAppHostSession = () => McpAppHostSessionView | null;

export interface McpAppHostBindings {
  resolveSandboxOrigin: () => string;
  panelOrigin?: () => string;
  onCallTool: (appSessionId: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onHeightChange?: (toolCallId: string, height: number) => void;
  hostName?: string;
  hostVersion?: string;
}
