/**
 * MCP 2026-07-28 monorepo 多 Server HTTP 聚合网关。
 *
 * 单一 HTTP 端口按路径分发到严格 modern-only 的 MCP handler。0728 协议无
 * transport session，每个请求由 SDK 创建独立 Server 实例；subscriptions/listen
 * 由每个路由 handler 独立维护。
 */
import {
    createMcpHandler,
    type McpServerFactory,
    type ServerEventBus,
    type ServerNotifier,
} from "@modelcontextprotocol/server";

export interface GatewayRoute {
    /** 唯一路径，如 "/openspec/mcp"。 */
    path: string;
    /** 每个 HTTP 请求创建独立 Server 实例。 */
    createServer: McpServerFactory;
    /** 多进程部署时可为该端点注入共享事件总线。 */
    bus?: ServerEventBus;
}

export interface GatewayOptions {
    host?: string;
    port?: number;
    maxSubscriptions?: number;
    keepAliveMs?: number;
}

export interface GatewayRouteHandle {
    path: string;
    subscriptions: ServerNotifier;
}

export interface GatewayHandle {
    url: string;
    stop: () => Promise<void>;
    routes: GatewayRoute[];
    endpoints: GatewayRouteHandle[];
    fetch: (request: Request) => Promise<Response>;
}

export interface GatewayRoutesHandle {
    routes: GatewayRoute[];
    endpoints: GatewayRouteHandle[];
    fetch: (request: Request) => Promise<Response>;
    close: () => Promise<void>;
}

/** 路径规范化：保证以 / 开头、不以 / 结尾。 */
export function normalizePath(path: string): string {
    let normalized = path.startsWith("/") ? path : `/${path}`;
    if (normalized.length > 1 && normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}

/** 创建不绑定监听端口的严格 0728 路由句柄。 */
export function createGatewayRoutes(
    routes: GatewayRoute[],
    options: Pick<GatewayOptions, "maxSubscriptions" | "keepAliveMs"> = {},
): GatewayRoutesHandle {
    const seen = new Set<string>();
    const normalized = routes.map((route) => {
        const path = normalizePath(route.path);
        if (seen.has(path)) {
            throw new Error(`MCPP gateway: duplicate route path '${path}'`);
        }
        seen.add(path);
        return { ...route, path };
    });

    const handlers = new Map(
        normalized.map((route) => [
            route.path,
            createMcpHandler(route.createServer, {
                legacy: "reject",
                bus: route.bus,
                maxSubscriptions: options.maxSubscriptions,
                keepAliveMs: options.keepAliveMs,
            }),
        ]),
    );

    return {
        routes: normalized,
        endpoints: normalized.map((route) => ({
            path: route.path,
            subscriptions: handlers.get(route.path)!.notify,
        })),
        async fetch(request) {
            const path = normalizePath(new URL(request.url).pathname);
            const handler = handlers.get(path);
            if (!handler) {
                return new Response("MCPP gateway: route not found", { status: 404 });
            }
            return handler.fetch(request);
        },
        async close() {
            await Promise.all([...handlers.values()].map((handler) => handler.close()));
        },
    };
}

/** 启动仅支持 MCP 2026-07-28 的 Bun HTTP 聚合网关。 */
export async function createGateway(
    routes: GatewayRoute[],
    options: GatewayOptions = {},
): Promise<GatewayHandle> {
    const host = options.host ?? process.env.HOST ?? "127.0.0.1";
    const port = Number(options.port ?? process.env.PORT ?? 8457);
    const handle = createGatewayRoutes(routes, options);
    const bunServer = Bun.serve({
        hostname: host,
        port,
        fetch: handle.fetch,
    });

    return {
        url: `http://${host}:${bunServer.port}`,
        routes: handle.routes,
        endpoints: handle.endpoints,
        fetch: handle.fetch,
        async stop() {
            bunServer.stop();
            await handle.close();
        },
    };
}
