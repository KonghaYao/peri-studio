import { McpAppFrameShell } from '@peri/ui';
import {
  callMcpAppTool,
  liveMcpApp,
  liveMcpAppHeight,
  sandboxOrigin,
  setMcpAppHeight,
} from '@/features/mcp/mcp-apps';

export function McpAppFrame(props: { toolCallId: string }) {
  const toolCallId = () => props.toolCallId;
  return (
    <McpAppFrameShell
      session={() => liveMcpApp(toolCallId())}
      height={() => liveMcpAppHeight(toolCallId())}
      bindings={{
        resolveSandboxOrigin: sandboxOrigin,
        onCallTool: callMcpAppTool,
        onHeightChange: (id, height) => setMcpAppHeight(id, height),
      }}
    />
  );
}
