import { describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/server";
import { createGatewayRoutes } from "./gateway.ts";

function createServer(): McpServer {
    return new McpServer({ name: "test", version: "1.0.0" });
}

describe("createGatewayRoutes", () => {
    test("拒绝 2025-era initialize 请求", async () => {
        const gateway = createGatewayRoutes([{ path: "/test/mcp", createServer }]);
        try {
            const response = await gateway.fetch(
                new Request("http://localhost/test/mcp", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        id: 1,
                        method: "initialize",
                        params: {
                            protocolVersion: "2025-11-25",
                            capabilities: {},
                            clientInfo: { name: "legacy", version: "1.0.0" },
                        },
                    }),
                }),
            );

            expect(response.status).toBe(400);
            const body = await response.json() as { error?: { code?: number } };
            expect(body.error?.code).toBe(-32022);
        } finally {
            await gateway.close();
        }
    });

    test("暴露每个端点的 subscription 发布句柄", async () => {
        const gateway = createGatewayRoutes([{ path: "test/mcp/", createServer }]);
        try {
            expect(gateway.endpoints[0]?.path).toBe("/test/mcp");
            expect(gateway.endpoints[0]?.subscriptions.toolsChanged).toBeFunction();
            expect(gateway.endpoints[0]?.subscriptions.resourceUpdated).toBeFunction();
        } finally {
            await gateway.close();
        }
    });
});
