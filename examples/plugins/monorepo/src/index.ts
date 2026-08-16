/**
 * monorepo 聚合 server —— MCPP 3.7：单一 HTTP 出口，路径路由到多个子 server。
 *
 *   /office/mcp   → office 子 server（子项目，skills / tools / resources 全量）
 *   /hello/mcp    → hello 子 server（最小 tool）
 *   /openspec/mcp → openspec 子 server（第三方 OpenSpec skills 集，openspec/skills）
 *
 * 形态要点：
 *   - 一个进程、一个端口，是所有子 server 唯一的入口（顶层挂载多个 MCP server）
 *   - 每个路径是独立的 MCP endpoint / origin：客户端按 URL 连接，各自独立协商
 *   - stdio 不适用该形态（stdio 无 URL/路径概念，3.7 约束）
 *
 * 项目结构：本目录是聚合上层，office/ 是其子项目（标准 Agent Plugin），
 * 通过 workspace 依赖 `office` 导入其 server 工厂。
 *
 * 运行：bun src/index.ts            → 监听 http://127.0.0.1:8787/
 *        bun test/smoke.ts          → 官方 client 分别连接两个端点验证
 */
import { createGateway, type GatewayHandle } from "@peri/mcpp";
import { createOfficeServer } from "office";
import { createHelloServer } from "./servers/hello.ts";
import { createOpenspecServer } from "./servers/openspec.ts";

export interface MonorepoOptions {
    host?: string;
    port?: number;
}

/**
 * 聚合网关：挂载表即路由表（子 server 各自独立实例，monorepo 隔离）。
 * office 的 skills/ 目录通过 office 子 server 的 ResourceForSkills 投影，
 * 在 /office/mcp 端点下自动可见。
 */
export function createMonorepoGateway(options: MonorepoOptions = {}): Promise<GatewayHandle> {
    return createGateway(
        [
            // /xxx/mcp → xxx 子 server（3.7：路径即挂载表，唯一 HTTP 出口）
            { path: "/office/mcp", createServer: createOfficeServer },
            { path: "/hello/mcp", createServer: createHelloServer },
            { path: "/openspec/mcp", createServer: createOpenspecServer },
        ],
        {
            host: options.host ?? "127.0.0.1",
            port: options.port ?? 8787,
        },
    );
}

if (import.meta.main) {
    const gw = await createMonorepoGateway();
    console.log(`monorepo gateway listening: ${gw.url}`); // → http://127.0.0.1:8787/
    console.log(`routes: ${gw.routes.map((r) => r.path).join(", ")}`);
}