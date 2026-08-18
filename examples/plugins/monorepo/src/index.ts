/**
 * monorepo 聚合 server —— MCPP 3.7：单一 HTTP 出口，路径路由到子 server。
 *
 *   /openspec/mcp → openspec 子 server（第三方 OpenSpec skills 集，openspec/skills）
 *
 * 形态要点：
 *   - 一个进程、一个端口，是所有子 server 唯一的入口（顶层挂载多个 MCP server）
 *   - 每个路径是独立的 MCP endpoint / origin：客户端按 URL 连接，各自独立协商
 *   - stdio 不适用该形态（stdio 无 URL/路径概念，3.7 约束）
 *
 * 运行：bun src/index.ts            → 监听 http://127.0.0.1:8457/
 *        bun test/smoke.ts          → 官方 client 连接端点验证
 */
import { resolve } from "node:path";
import {
    createGateway,
    createGatewayRoutes,
    DEFAULT_MCPP_HTTP_HOST,
    DEFAULT_MCPP_HTTP_PORT,
    type GatewayHandle,
    type GatewayRoutesHandle,
} from "@peri-code/mcpp";
import { createOpenspecServer } from "../openspec/server.ts";

/** 挂载表：/xxx/mcp → xxx 子 server（3.7：路径即路由，唯一 HTTP 出口）。 */
export const MONOREPO_ROUTES = [
    {
        path: "/openspec/mcp",
        createServer: createOpenspecServer,
        catalog: {
            id: "openspec",
            title: "OpenSpec Recipes",
            description: "Workflow skills for proposing, applying, and verifying OpenSpec changes.",
            version: "1.0.0",
            tags: ["specification", "workflow"],
            capabilities: ["resources", "skills"],
            auth: { required: false },
        },
    },
] as const;

async function serveDemo(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && (path === "/" || path === "/catalog-demo.html")) {
        return new Response(Bun.file(resolve(import.meta.dir, "../catalog-demo.html")), {
            headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
            },
        });
    }
    return new Response("MCPP monorepo demo: route not found", { status: 404 });
}

export interface MonorepoOptions {
    host?: string;
    port?: number;
}

/**
 * 纯请求分发（无监听进程）：Cloudflare Workers / 边缘运行时部署用。
 * 每个路由使用独立的 MCP 2026-07-28 handler 与 subscription 总线。
 */
export function createMonorepoRoutes(): GatewayRoutesHandle {
    return createGatewayRoutes([...MONOREPO_ROUTES], {
        catalog: {
            path: "/catalog/mcp",
            name: "mcpp-monorepo-catalog",
            version: "1.0.0",
        },
    });
}

/**
 * 聚合网关（本机形态）：挂载表即路由表（子 server 各自独立实例，monorepo 隔离）。
 * openspec 的 skills/ 目录通过 openspec 子 server 的 ResourceForSkills 投影，
 * 在 /openspec/mcp 端点下自动可见。
 */
export function createMonorepoGateway(options: MonorepoOptions = {}): Promise<GatewayHandle> {
    return createGateway([...MONOREPO_ROUTES], {
        host: options.host ?? DEFAULT_MCPP_HTTP_HOST,
        port: options.port ?? DEFAULT_MCPP_HTTP_PORT,
        catalog: {
            path: "/catalog/mcp",
            name: "mcpp-monorepo-catalog",
            version: "1.0.0",
        },
        fallback: serveDemo,
    });
}

if (import.meta.main) {
    const gw = await createMonorepoGateway();
    console.log(`monorepo gateway listening: ${gw.url}`);
    console.log(`routes: ${gw.endpoints.map((endpoint) => endpoint.path).join(", ")}`);
    console.log(`catalog demo: ${gw.url}/`);
}