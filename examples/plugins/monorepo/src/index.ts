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
 * 运行：bun src/index.ts            → 监听 http://127.0.0.1:8787/
 *        bun test/smoke.ts          → 官方 client 连接端点验证
 */
import {
    createGateway,
    createGatewayRoutes,
    type GatewayHandle,
    type GatewayRoutesHandle,
} from "@peri-code/mcpp";
import { createOpenspecServer } from "../openspec/server.ts";

/** 挂载表：/xxx/mcp → xxx 子 server（3.7：路径即路由，唯一 HTTP 出口）。 */
export const MONOREPO_ROUTES = [
    { path: "/openspec/mcp", createServer: createOpenspecServer },
] as const;

export interface MonorepoOptions {
    host?: string;
    port?: number;
}

/**
 * 纯请求分发（无监听进程）：Cloudflare Workers / 边缘运行时部署用。
 * 会话注册表驻留于句柄生命周期（单 isolate 内存态，见 wrangler 注释）。
 */
export function createMonorepoRoutes(): GatewayRoutesHandle {
    return createGatewayRoutes([...MONOREPO_ROUTES]);
}

/**
 * 聚合网关（本机形态）：挂载表即路由表（子 server 各自独立实例，monorepo 隔离）。
 * openspec 的 skills/ 目录通过 openspec 子 server 的 ResourceForSkills 投影，
 * 在 /openspec/mcp 端点下自动可见。
 */
export function createMonorepoGateway(options: MonorepoOptions = {}): Promise<GatewayHandle> {
    return createGateway([...MONOREPO_ROUTES], {
        host: options.host ?? "127.0.0.1",
        port: options.port ?? 8787,
    });
}

if (import.meta.main) {
    const gw = await createMonorepoGateway();
    console.log(`monorepo gateway listening: ${gw.url}`); // → http://127.0.0.1:8787/
    console.log(`routes: ${gw.routes.map((r) => r.path).join(", ")}`);
}