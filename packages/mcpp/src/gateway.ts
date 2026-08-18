/**
 * MCP 2026-07-28 monorepo 多 Server HTTP 聚合网关。
 *
 * 单一 HTTP 端口按路径分发到严格 modern-only 的 MCP handler。0728 协议无
 * transport session，每个请求由 SDK 创建独立 Server 实例；subscriptions/listen
 * 由每个路由 handler 独立维护。
 */
import {
    createMcpHandler,
    type McpRequestContext,
    type McpServerFactory,
    type ServerEventBus,
    type ServerNotifier,
} from "@modelcontextprotocol/server";
import {
    createServerCatalog,
    type ServerCatalogEntry,
    type ServerCatalogOptions,
} from "./catalog.ts";
import { DEFAULT_MCPP_HTTP_HOST, DEFAULT_MCPP_HTTP_PORT } from "./server/defaults.ts";

export interface GatewayRoute {
    /** 唯一路径，如 "/openspec/mcp"。 */
    path: string;
    /** 每个 HTTP 请求创建独立 Server 实例。 */
    createServer: McpServerFactory;
    /** 在只读 Catalog 中公开的摘要；缺失则该 endpoint 不进入目录。 */
    catalog?: ServerCatalogEntry;
    /** 多进程部署时可为该端点注入共享事件总线。 */
    bus?: ServerEventBus;
}

/** Gateway 派生的只读 Server Catalog endpoint。 */
export interface GatewayCatalogOptions extends ServerCatalogOptions {
    /** Catalog 的 MCP 路径，默认 "/catalog/mcp"。 */
    path?: string;
    /**
     * 为当前已验证的请求身份过滤可发现条目。未配置时所有带 catalog 摘要的静态
     * mount 都可见；实现按租户/角色隔离时必须提供此函数，避免目录泄露。
     */
    filterEntries?: (
        entries: ReadonlyArray<ServerCatalogEntry & { endpointPath: string }>,
        context: McpRequestContext,
    ) => ReadonlyArray<ServerCatalogEntry & { endpointPath: string }>;
}

export interface GatewayOptions {
    host?: string;
    port?: number;
    maxSubscriptions?: number;
    keepAliveMs?: number;
    /** 启用后，只从 routes[].catalog 派生已挂载 Child endpoint 的只读目录。 */
    catalog?: GatewayCatalogOptions;
    /** 未命中 MCP 路由时的可选只读 HTTP 页面或静态资源处理器。 */
    fallback?: (request: Request) => Response | Promise<Response>;
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
    options: Pick<GatewayOptions, "maxSubscriptions" | "keepAliveMs" | "catalog" | "fallback"> = {},
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

    const catalogOptions = options.catalog;
    const catalogPath = catalogOptions ? normalizePath(catalogOptions.path ?? "/catalog/mcp") : undefined;
    if (catalogPath && seen.has(catalogPath)) {
        throw new Error(`MCPP gateway: catalog path '${catalogPath}' conflicts with a child endpoint`);
    }

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

    if (catalogPath && catalogOptions) {
        const entries = normalized.flatMap((route) =>
            route.catalog ? [{ ...route.catalog, endpointPath: route.path }] : []
        );
        const catalog = awaitCatalogFactory(entries, catalogOptions);
        handlers.set(
            catalogPath,
            createMcpHandler(catalog, {
                legacy: "reject",
                maxSubscriptions: options.maxSubscriptions,
                keepAliveMs: options.keepAliveMs,
            }),
        );
    }

    const endpointPaths = [...handlers.keys()];
    return {
        routes: normalized,
        endpoints: endpointPaths.map((path) => ({
            path,
            subscriptions: handlers.get(path)!.notify,
        })),
        async fetch(request) {
            const path = normalizePath(new URL(request.url).pathname);
            const handler = handlers.get(path);
            if (handler) return handler.fetch(request);
            if (options.fallback) return options.fallback(request);
            return new Response("MCPP gateway: route not found", { status: 404 });
        },
        async close() {
            await Promise.all([...handlers.values()].map((handler) => handler.close()));
        },
    };
}

function awaitCatalogFactory(
    entries: ReadonlyArray<ServerCatalogEntry & { endpointPath: string }>,
    options: GatewayCatalogOptions,
): McpServerFactory {
    const { filterEntries, path: _path, ...serverOptions } = options;
    return async (context) => {
        const visibleIds = filterEntries
            ? new Set(filterEntries(entries, context).map((entry) => entry.id))
            : undefined;
        // 筛选器只能收缩静态 mount 表；不能注入指向未挂载 endpoint 的条目。
        const visibleEntries = visibleIds
            ? entries.filter((entry) => visibleIds.has(entry.id))
            : entries;
        return createServerCatalog(visibleEntries, serverOptions);
    };
}

/** 启动仅支持 MCP 2026-07-28 的 Bun HTTP 聚合网关。 */
export async function createGateway(
    routes: GatewayRoute[],
    options: GatewayOptions = {},
): Promise<GatewayHandle> {
    const host = options.host ?? process.env.HOST ?? DEFAULT_MCPP_HTTP_HOST;
    const port = Number(options.port ?? process.env.PORT ?? DEFAULT_MCPP_HTTP_PORT);
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
