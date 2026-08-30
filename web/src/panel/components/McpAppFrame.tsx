import { createEffect, onCleanup, Show } from 'solid-js';
import {
  callMcpAppTool,
  liveMcpApp,
  sandboxOrigin,
  setMcpAppHeight,
  type LiveMcpAppSession,
} from '../lib/mcp-apps';

const DEFAULT_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' data:",
  "connect-src 'none'",
].join('; ');

const MAX_APP_HEIGHT = 480;
const MCP_APPS_PROTOCOL = '2026-01-26';

export function McpAppFrame(props: { toolCallId: string }) {
  let sandboxRef: HTMLIFrameElement | undefined;
  const pendingCallIds = new Map<string | number, true>();

  createEffect(() => {
    const session = liveMcpApp(props.toolCallId);
    if (!session?.html || !sandboxRef) return;

    const hostOrigin = window.location.origin;
    const sandboxTarget = sandboxOrigin();
    const sandboxUrl = `${sandboxTarget}/sandbox.html?host=${encodeURIComponent(hostOrigin)}`;
    sandboxRef.src = sandboxUrl;

    let resourceSent = false;
    let toolPayloadSent = false;

    const postToSandbox = (message: Record<string, unknown>) => {
      sandboxRef?.contentWindow?.postMessage(message, sandboxTarget);
    };

    const sendToolPayload = () => {
      if (toolPayloadSent) return;
      toolPayloadSent = true;
      postToSandbox({
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-input',
        params: { arguments: session.toolInput },
      });
      postToSandbox({
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-result',
        params: session.toolResult,
      });
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== sandboxTarget) return;
      if (event.source !== sandboxRef?.contentWindow) return;
      const data = event.data as Record<string, unknown>;
      if (!data || typeof data !== 'object') return;

      if (data.method === 'ui/notifications/sandbox-proxy-ready') {
        if (!resourceSent) {
          resourceSent = true;
          postToSandbox({
            jsonrpc: '2.0',
            method: 'ui/notifications/sandbox-resource-ready',
            params: { html: session.html, csp: session.csp || DEFAULT_CSP },
          });
        }
        return;
      }

      if (data.method === 'ui/initialize') {
        const id = dataId(data);
        postToSandbox({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_APPS_PROTOCOL,
            hostInfo: { name: 'peri-studio' },
            hostContext: {
              theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
              containerDimensions: { maxHeight: MAX_APP_HEIGHT },
            },
          },
        });
        return;
      }

      if (data.method === 'ui/notifications/initialized') {
        sendToolPayload();
        return;
      }

      if (data.method === 'ui/notifications/size-changed') {
        const params = data.params as Record<string, unknown> | undefined;
        const height = Number(params?.height);
        if (Number.isFinite(height)) setMcpAppHeight(props.toolCallId, height);
        return;
      }

      if (data.method === 'tools/call' && session.appSessionId) {
        const id = dataId(data);
        if (id !== undefined) pendingCallIds.set(id, true);
        callMcpAppTool(session.appSessionId, data);
        return;
      }

      if (data.method === 'ui/open-link') {
        const params = data.params as Record<string, unknown> | undefined;
        if (typeof params?.url === 'string' && params.url.startsWith('https:')) {
          window.open(params.url, '_blank', 'noopener,noreferrer');
        }
      }
    };

    const onCallResult = (event: Event) => {
      const detail = (event as CustomEvent).detail as { appSessionId?: string; result?: unknown };
      if (detail.appSessionId !== session.appSessionId) return;
      const payload = detail.result;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
      const rpc = payload as Record<string, unknown>;
      const id = rpc.id;
      if (typeof id !== 'string' && typeof id !== 'number') return;
      if (!pendingCallIds.has(id)) return;
      pendingCallIds.delete(id);
      if (rpc.error !== undefined) {
        postToSandbox({ jsonrpc: '2.0', id, error: rpc.error });
        return;
      }
      postToSandbox({ jsonrpc: '2.0', id, result: rpc.result });
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('peri-mcp-app-call-result', onCallResult as EventListener);
    onCleanup(() => {
      pendingCallIds.clear();
      window.removeEventListener('message', onMessage);
      window.removeEventListener('peri-mcp-app-call-result', onCallResult as EventListener);
    });
  });

  return (
    <Show when={liveMcpApp(props.toolCallId)} keyed>
      {(session: LiveMcpAppSession) => (
        <div class="mcp-app-frame w-full max-w-(--tool-activity-max) overflow-hidden rounded-9 border border-divider bg-surface">
          <iframe
            ref={sandboxRef}
            title="MCP App sandbox"
            class="w-full border-0"
            style={{ height: `${session.height}px` }}
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      )}
    </Show>
  );
}

function dataId(data: Record<string, unknown>): string | number | undefined {
  return typeof data.id === 'string' || typeof data.id === 'number' ? data.id : undefined;
}
