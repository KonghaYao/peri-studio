// 官方 App Bridge Host：null MCP client，tools/call 由 T4 注入回 Hub。
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import {
  MCP_APP_HOST_NAME,
  MCP_APP_HOST_VERSION,
  MCP_APP_MAX_WIDTH,
  mcpAppInlineMaxHeight,
} from './mcp-app-layout';
import { asCallToolResult, asToolInputParams, describeMcpAppPayload } from './mcp-app-payload';
import type { McpAppHostBindings, McpAppHostHandle, McpAppHostSession } from './types';

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

/** 官方顺序：proxy-ready → connect → resource-ready；tool payload 挂在每一次 initialized 上。 */
export async function bindMcpAppHost(
  iframe: HTMLIFrameElement,
  session: McpAppHostSession,
  signal: AbortSignal,
  bindings: McpAppHostBindings,
): Promise<McpAppHostHandle | null> {
  const initial = session();
  if (!initial?.html) {
    console.warn('[mcp-apps] bind skipped: no html', { hasSession: Boolean(initial) });
    return null;
  }
  const sandboxTarget = bindings.resolveSandboxOrigin();
  const html = withCspMeta(initial.html, initial.csp);
  console.info('[mcp-apps] bind', {
    toolCallId: initial.toolCallId,
    appSessionId: initial.appSessionId,
    htmlChars: initial.html.length,
    injectedCsp: html !== initial.html,
    toolResult: describeMcpAppPayload(initial.toolResult),
  });

  const hostName = bindings.hostName ?? MCP_APP_HOST_NAME;
  const hostVersion = bindings.hostVersion ?? MCP_APP_HOST_VERSION;
  const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const bridge = new AppBridge(
    null,
    { name: hostName, version: hostVersion },
    { openLinks: {}, serverTools: {} },
    {
      hostContext: {
        theme,
        displayMode: 'inline',
        platform: 'web',
        containerDimensions: { maxHeight: mcpAppInlineMaxHeight(), maxWidth: MCP_APP_MAX_WIDTH },
      },
    },
  );

  bridge.oncalltool = async (params) => {
    const current = session();
    if (!current) throw new Error('MCP App session gone');
    const result = await bindings.onCallTool(current.appSessionId, {
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
    bindings.onHeightChange?.(current.toolCallId, height);
  });
  bridge.onopenlink = async ({ url }) => {
    if (typeof url === 'string' && url.startsWith('https:')) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    return {};
  };

  let initializedCount = 0;
  const pushToolPayload = () => {
    initializedCount += 1;
    if (signal.aborted) {
      console.warn('[mcp-apps] initialized ignored: bind aborted', { n: initializedCount });
      return;
    }
    const current = session();
    if (!current) {
      console.warn('[mcp-apps] initialized ignored: session gone', { n: initializedCount });
      return;
    }
    const result = asCallToolResult(current.toolResult);
    console.info('[mcp-apps] initialized → push', {
      n: initializedCount,
      toolCallId: current.toolCallId,
      toolResult: describeMcpAppPayload(result),
    });
    void (async () => {
      await bridge.sendToolInput(asToolInputParams(current.toolInput));
      await bridge.sendToolResult(result as Parameters<AppBridge['sendToolResult']>[0]);
      console.info('[mcp-apps] pushed tool-input + tool-result', { n: initializedCount });
    })().catch((error) => {
      if (!isAbortError(error)) console.warn('[mcp-apps] push failed', { n: initializedCount, error });
    });
  };
  bridge.addEventListener('initialized', pushToolPayload);

  try {
    const panelOrigin = bindings.panelOrigin?.() ?? window.location.origin;
    await loadSandboxProxy(iframe, sandboxTarget, panelOrigin, signal);
    console.info('[mcp-apps] sandbox-proxy-ready', { origin: sandboxTarget });
    if (signal.aborted || !iframe.contentWindow) {
      await bridge.close();
      return null;
    }
    await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
    await bridge.sendSandboxResourceReady({ html });
    console.info('[mcp-apps] sandbox-resource-ready sent');
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
    console.warn('[mcp-apps] bind failed', error);
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function loadSandboxProxy(
  iframe: HTMLIFrameElement,
  sandboxTarget: string,
  panelOrigin: string,
  signal: AbortSignal,
): Promise<void> {
  if (iframe.getAttribute('src')) return Promise.resolve();
  const ready = waitForProxyReady(iframe, sandboxTarget, signal);
  iframe.src = `${sandboxTarget}/sandbox.html?host=${encodeURIComponent(panelOrigin)}`;
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
