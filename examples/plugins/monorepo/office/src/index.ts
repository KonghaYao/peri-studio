/**
 * office MCP server demo：@peri/mcpp（MCPP 规范行参考实现）+ @modelcontextprotocol/server (v2)。
 * 提供文档 resource / tool / 订阅，并自动把 skills/ 目录挂载为 resources（MCPP 双通道 B）。
 *
 * 运行：
 *   - bun src/index.ts            → streamable HTTP server（默认，http://127.0.0.1:8457/mcp）
 *   - bun src/index.ts --stdio    → stdio transport（配 Claude Desktop / MCP Inspector）
 *   - bun test/demo-client.ts     → 进程内 InMemoryTransport 端到端演示
 */
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ResourceForSkills, startServer } from "@peri/mcpp";

/** 构建 office MCP server（同时可供 stdio / HTTP / gateway 复用）。 */
export function createOfficeServer(): McpServer {
    const server = new McpServer(
        { name: "office-cli", version: "1.0.0" },
        {
            instructions:
                "A minimal demo exposing resources, tools and resource subscriptions.",
        },
    );

    // 6. Subscription —— v2 SDK 不会为 McpServer 自动处理 resources/subscribe，
    //    需手动注册处理器 + 通告资源订阅能力位；内容变化时 sendResourceUpdated()
    //    只推送给已订阅的 uri，客户端无需轮询。
    const subscribedUris = new Set<string>();
    server.server.registerCapabilities({ resources: { subscribe: true } });
    server.server.setRequestHandler("resources/subscribe", async (request) => {
        subscribedUris.add(request.params.uri);
        return {};
    });
    server.server.setRequestHandler(
        "resources/unsubscribe",
        async (request) => {
            subscribedUris.delete(request.params.uri);
            return {};
        },
    );

    // 7. Resource —— 自动挂载 skills/ 目录下的 skill（MCPP 3.4 通道 B 投影）
    ResourceForSkills(server, {
        // SDK 不假定宿主布局：显式传入 office/skills 目录（MCPP 3.4 双通道 A 的源）
        skillsDir: resolve(import.meta.dir, "..", "skills"),
    });

    server.registerTool(
        "anydoc",
        {
            title: "anydoc",
            description: "args: --help can know how to use it",
            inputSchema: z.object({ args: z.string() }),
        },
        async (input) => {
            const args = input.args.split(" ").filter(Boolean);
            const proc = Bun.spawn(
                ["bunx", "-y", "@firecrawl/anydoc", ...args],
                {
                    stdout: "pipe",
                    stderr: "pipe",
                },
            );
            await proc.exited;
            if (proc.exitCode !== 0) {
                const errText = await proc.stderr.text();
                throw new Error(
                    `anydoc exited with code ${proc.exitCode}: ${errText}`,
                );
            }
            return {
                content: [{ type: "text", text: await proc.stdout.text() }],
            };
        },
    );

    // 8. Tool —— 订阅触发器（demo）：模拟某个 skill 的 SKILL.md 内容变更，
    //    向已订阅该资源的客户端推送 notifications/resources/updated
    server.registerTool(
        "notify_skill_changed",
        {
            title: "notify_skill_changed",
            description:
                "Simulate a change to a skill's SKILL.md and push resources/updated to subscribers",
            inputSchema: z.object({ skillName: z.string() }),
        },
        async (input) => {
            await server.server.sendResourceUpdated({
                uri: `skill://${input.skillName}/SKILL.md`,
            });
            return { content: [{ type: "text", text: "notification sent" }] };
        },
    );

    return server;
}

// MCPP 双模式启动：默认 streamable HTTP，`--stdio` 走 stdio（3.1 承载）。
// import.meta.main 保护：被上层聚合 server（monorepo）导入 createOfficeServer 时
// 不附带启动副作用（3.7：子 server 交由网关统一承载）。
if (import.meta.main) {
    startServer(createOfficeServer());
}