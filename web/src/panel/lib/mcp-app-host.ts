// 官方 App Bridge Host：null MCP client，tools/call 回 Peri 闸门。
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import {
  asCallToolResult,
  asToolInputParams,
  callMcpAppTool,
  MCP_APP_HOST_VERSION,
  MCP_APP_MAX_HEIGHT,
  MCP_APP_MAX_WIDTH,
  sandboxOrigin,
  setMcpAppHeight,
  type LiveMcpAppSession,
} from './mcp-apps';

const DEFAULT_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join('; ');

export interface McpAppHostHandle {
  close(): Promise<void>;
}

export type McpAppHostSession = () => LiveMcpAppSession | null;

/** 官方顺序：proxy-ready → connect → resource-ready；tool payload 挂在每一次 initialized 上。 */
export async function bindMcpAppHost(
  iframe: HTMLIFrameElement,
  session: McpAppHostSession,
  signal: AbortSignal,
): Promise<McpAppHostHandle | null> {
  const initial = session();
  if (!initial?.html) return null;
  const sandboxTarget = sandboxOrigin();
  const html = withCspMeta(initial.html, initial.csp);

  const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const bridge = new AppBridge(
    null,
    { name: 'peri-studio', version: MCP_APP_HOST_VERSION },
    { openLinks: {}, serverTools: {} },
    {
      hostContext: {
        theme,
        displayMode: 'inline',
        platform: 'web',
        containerDimensions: { maxHeight: MCP_APP_MAX_HEIGHT, maxWidth: MCP_APP_MAX_WIDTH },
      },
    },
  );

  bridge.oncalltool = async (params) => {
    const current = session();
    if (!current) throw new Error('MCP App session gone');
    const result = await callMcpAppTool(current.appSessionId, {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/call',
      params,
    });
    return result as Awaited<ReturnType<NonNullable<AppBridge['oncalltool']>>>;
  };
  bridge.addEventListener('sizechange', ({ height }) => {
    const current = session();
    if (!current || typeof height !== 'number' || !Number.isFinite(height)) return;
    setMcpAppHeight(current.toolCallId, height);
  });
  bridge.onopenlink = async ({ url }) => {
    if (typeof url === 'string' && url.startsWith('https:')) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    return {};
  };

  const pushToolPayload = () => {
    if (signal.aborted) return;
    const current = session();
    if (!current) return;
    void (async () => {
      await bridge.sendToolInput(asToolInputParams(current.toolInput));
      await bridge.sendToolResult(
        asCallToolResult(current.toolResult) as Parameters<AppBridge['sendToolResult']>[0],
      );
    })().catch((error) => {
      if (!isAbortError(error)) console.warn('MCP App host failed to push tool payload', error);
    });
  };
  // 不用 oninitialized setter：会覆盖、会告警。canvas StrictMode 会多次 initialized，
  // 必须每次都推；bind 本身不等第一次握手结束。
  bridge.addEventListener('initialized', pushToolPayload);

  try {
    await loadSandboxProxy(iframe, sandboxTarget, signal);
    if (signal.aborted || !iframe.contentWindow) {
      await bridge.close();
      return null;
    }
    await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
    await bridge.sendSandboxResourceReady({ html });
    if (signal.aborted) {
      await bridge.close();
      return null;
    }
    return {
      close: () => bridge.close(),
    };
  } catch (error) {
    void bridge.close();
    if (signal.aborted || isAbortError(error)) return null;
    console.warn('MCP App host failed to bind', error);
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function loadSandboxProxy(
  iframe: HTMLIFrameElement,
  sandboxTarget: string,
  signal: AbortSignal,
): Promise<void> {
  // 官方 basic-host：已有 src 则不重设，避免整页重载 → 反复 sandbox-proxy-ready / loadView。
  if (iframe.getAttribute('src')) return Promise.resolve();
  const ready = waitForProxyReady(iframe, sandboxTarget, signal);
  iframe.src = `${sandboxTarget}/sandbox.html?host=${encodeURIComponent(window.location.origin)}`;
  return ready;
}

function waitForProxyReady(
  iframe: HTMLIFrameElement,
  sandboxTarget: string,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = () => {
      window.removeEventListener('message', onMessage);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== sandboxTarget || event.source !== iframe.contentWindow) return;
      const data = event.data as { jsonrpc?: string; method?: string } | null;
      if (data?.method !== 'ui/notifications/sandbox-proxy-ready') return;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      signal.removeEventListener('abort', fail);
      window.removeEventListener('message', onMessage);
    };
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', fail, { once: true });
    window.addEventListener('message', onMessage);
  });
}

function withCspMeta(html: string, csp: string | null): string {
  if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) return html;
  const header = csp?.trim() || DEFAULT_CSP;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${header.replace(/"/g, '&quot;')}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (head) => `${head}${meta}`);
  }
  return `<!DOCTYPE html><html><head>${meta}</head><body>${html}</body></html>`;
}
