import { onCleanup, onMount } from 'solid-js';
import { bindMcpAppHost } from '../lib/mcp-app-host';
import { liveMcpApp, liveMcpAppHeight } from '../lib/mcp-apps';

export function McpAppFrame(props: { toolCallId: string }) {
  let sandboxRef: HTMLIFrameElement | undefined;

  // iframe 生命周期跟组件挂载走，不跟 liveApps / Yjs 更新走。
  // 对话投影每帧都会换 session 对象；绑在 html 信号上会反复 abort → 重连。
  onMount(() => {
    const iframe = sandboxRef;
    const toolCallId = props.toolCallId;
    if (!iframe) return;
    const abort = new AbortController();
    const started = bindMcpAppHost(iframe, () => liveMcpApp(toolCallId), abort.signal).catch(() => null);
    onCleanup(() => {
      abort.abort();
      void started.then((handle) => handle?.close()).catch(() => undefined);
      iframe.removeAttribute('src');
    });
  });

  return (
    <div class="mcp-app-frame w-full max-w-(--tool-activity-max) overflow-hidden rounded-9 border border-divider bg-surface">
      <iframe
        ref={sandboxRef}
        title="MCP App sandbox"
        class="w-full border-0"
        style={{ height: `${liveMcpAppHeight(props.toolCallId)}px` }}
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}
