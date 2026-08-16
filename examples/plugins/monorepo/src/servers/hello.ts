/**
 * hello 子 server —— monorepo 拓扑中的第二个成员（MCPP 3.7 演示用）。
 *
 * 与 office 不同，它只暴露一个最小 tool，用于验证聚合出口下"每端点独立 origin、
 * 独立能力协商"：/office/mcp 有 skills 投影，/hello/mcp 只有 hello tool。
 *
 * 真实 monorepo 中每个子 server 可以是独立 workspace 包；此处作为模块驻留，
 * 关键是它们最终都挂在同一个网关出口上。
 */
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export function createHelloServer(): McpServer {
    const server = new McpServer(
        { name: "hello-demo", version: "1.0.0" },
        {
            instructions:
                "Minimal second endpoint aggregated by the monorepo gateway.",
        },
    );

    server.registerTool(
        "hello",
        {
            title: "hello",
            description: "Greet someone. Proves this endpoint is a separate MCP origin.",
            inputSchema: z.object({ name: z.string().optional() }),
        },
        async (input) => ({
            content: [{ type: "text", text: `Hello, ${input.name ?? "world"}!` }],
        }),
    );

    return server;
}