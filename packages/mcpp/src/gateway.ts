/**
 * createGateway —— MCPP 3.7 monorepo 多 server 聚合（HTTP 路径路由）。
 *
 * 单一 HTTP server 进程（唯一开放端口），按 URL 路径分发到子 server 的
 * MCP endpoint：`/openspec/mcp` → openspec 子 server（其余路径 404）。每个
 * 路径是一个独立的 MCP endpoint / origin（客户端按 URL 连接，
 * 各自独立协商 —— 3.7 模式定义）。
 *
 * stdio 不适用该形态（stdio 无 URL/路径概念，3.7 约束）。
 *
 * 会话模型（v2 SDK 单会话 transport 的多会话用法）：每个 endpoint 维护一个
 * session 注册表 —— 首个无 `mcp-session-id` 的请求（initialize）创建新的
 * transport + server 实例，经 onsessioninitialized 注册；后续带 session id
 * 的请求路由到对应实例；DELETE 关闭经 onsessionclosed 注销。因此同一端点
 * 可承载多个并发客户端会话，且每会话 server 状态隔离。
 */
import {
    McpServer,
    WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";

export interface GatewayRoute {
    /** 唯一路径，如 "/openspec/mcp"。首尾按需规范化。 */
    path: string;
    /** 指定 endpoint 的 server 工厂：每路由/每会话独立实例（monorepo 各端点隔离，3.7）。 */
    createServer: () => McpServer;
}

export interface GatewayOptions {
    host?: string;
    port?: number;
}

export interface GatewayHandle {
    url: string;
    /** 关闭测试：关闭已启动的 Bun server / 所有会话的 transport 资源。 */
    stop: () => Promise<void>;
    routes: GatewayRoute[];
    /** 纯 fetch 分发（同 createGatewayRoutes.fetch，serverless 形态直接复用）。 */
    fetch: (request: Request) => Promise<Response>;
}

/** serverless 形态句柄：无监听进程，仅请求分发（Cloudflare Workers 等）。 */
export interface GatewayRoutesHandle {
    routes: GatewayRoute[];
    /** 标准 fetch handler：Worker 的 export default { fetch } 可直接委托。 */
    fetch: (request: Request) => Promise<Response>;
    /** 关闭所有端点上所有会话的 transport 资源。 */
    close: () => Promise<void>;
}

/** 路径规范化：保证以 / 开头、不以 / 结尾（根 "" → "/"）。 */
export function normalizePath(p: string): string {
    let s = p.startsWith("/") ? p : `/${p}`;
    if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
    return s;
}

/** 单端点的会话注册表：sessionId → 该会话的 transport + server 实例。 */
type SessionEntry = {
    transport: WebStandardStreamableHTTPServerTransport;
    server: McpServer;
};

function createEndpointHandler(createServer: () => McpServer) {
    const sessions = new Map<string, SessionEntry>();

    const handle = async (request: Request): Promise<Response> => {
        const sessionId = request.headers.get("mcp-session-id");

        // 已有会话：路由到该会话的 transport（无效 id → 404，SDK 语义）
        if (sessionId) {
            const entry = sessions.get(sessionId);
            if (!entry) {
                return new Response(`MCPP gateway: unknown session '${sessionId}'`, {
                    status: 404,
                });
            }
            return entry.transport.handleRequest(request);
        }

        // 新会话（initialize）：创建独立 transport + server，注册后处理请求
        let transport!: WebStandardStreamableHTTPServerTransport;
        const server = createServer();
        transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id) => {
                sessions.set(id, { transport, server });
            },
            onsessionclosed: (id) => {
                sessions.delete(id);
            },
        });
        await server.connect(transport);
        return transport.handleRequest(request);
    };

    return { handle, sessions };
}

/**
 * 路径路由分发（无监听进程）：校验挂载表 + 建立端点会话注册表。
 *
 * 与 createGateway 的唯一区别是不绑定 Bun.serve —— 因此可直接托管到任何
 * 提供标准 fetch handler 的运行环境（Cloudflare Workers / 边缘运行时）。
 * 会话注册表驻留于 handle 生命周期内（单 isolate 内存态；多实例部署需
 * 会话外置，如 CF Durable Objects）。
 */
export function createGatewayRoutes(routes: GatewayRoute[]): GatewayRoutesHandle {
    // 路径唯一性校验：重复路径直接抛出（3.7：端点路径 MUST 明确可审计）
    const seen = new Set<string>();
    const normalized = routes.map((r) => {
        const path = normalizePath(r.path);
        if (seen.has(path)) {
            throw new Error(`[mcpp/gateway] 重复端点路径 '${path}' —— 路径 MUST 可审计（3.7）`);
        }
        seen.add(path);
        return { ...r, path };
    });

    // 每 route 一个会话注册表（endpoint = 独立 origin，会话彼此隔离）
    const endpoints = new Map(normalized.map((r) => [r.path, createEndpointHandler(r.createServer)]));

    const fetch = async (request: Request): Promise<Response> => {
        const { pathname } = new URL(request.url);
        const endpoint = endpoints.get(pathname);
        if (!endpoint) {
            return new Response(`MCPP gateway: no endpoint at '${pathname}'`, {
                status: 404,
            });
        }
        return endpoint.handle(request);
    };

    const close = async (): Promise<void> => {
        // 关闭所有端点上所有会话的 transport（defensive：SDK 版本差异容错）
        for (const endpoint of endpoints.values()) {
            for (const { transport } of endpoint.sessions.values()) {
                try {
                    const closer = transport as { close?: () => Promise<void> };
                    await closer.close?.();
                } catch {
                    // ignore：transport 可能已随连接终止
                }
            }
            endpoint.sessions.clear();
        }
    };

    return { routes: normalized, fetch, close };
}

/**
 * 启动聚合 HTTP 出口（本机/进程内部署形态）。
 *
 * @param routes 路径 → 子 server 工厂映射（挂载关系为静态注册表，3.7 模式定义）
 * @returns 监听地址与 stop 句柄（测试/生命周期管理用）
 */
export async function createGateway(
    routes: GatewayRoute[],
    options: GatewayOptions = {},
): Promise<GatewayHandle> {
    const host = options.host ?? process.env.HOST ?? "127.0.0.1";
    const port = Number(options.port ?? process.env.PORT ?? 8457);

    const handle = createGatewayRoutes(routes);

    const bunServer = Bun.serve({
        hostname: host,
        port,
        fetch: handle.fetch,
    });

    return {
        url: `http://${host}:${bunServer.port}/`,
        routes: handle.routes,
        fetch: handle.fetch,
        async stop() {
            bunServer.stop();
            await handle.close();
        },
    };
}
