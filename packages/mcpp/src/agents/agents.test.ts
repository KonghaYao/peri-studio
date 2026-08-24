import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { createGatewayRoutes } from "../gateway.ts";
import {
    agentUri,
    isValidAgentName,
    parseAgentFrontmatter,
} from "./agent.ts";
import { ResourceForAgents } from "./ResourceForAgents.ts";
import { readAgentResource, scanAgentsDir } from "./scan.ts";

const protocolVersion = "2026-07-28";
type Gateway = ReturnType<typeof createGatewayRoutes>;

async function request(
    gateway: Gateway,
    method: string,
    params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const response = await gateway.fetch(new Request("http://localhost/agents/mcp", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "MCP-Protocol-Version": protocolVersion,
            "Mcp-Method": method,
            ...(typeof params.uri === "string" ? { "Mcp-Name": params.uri } : {}),
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: method,
            method,
            params: {
                ...params,
                _meta: {
                    "io.modelcontextprotocol/protocolVersion": protocolVersion,
                    "io.modelcontextprotocol/clientInfo": { name: "agent-resources-test", version: "1" },
                    "io.modelcontextprotocol/clientCapabilities": {},
                },
            },
        }),
    }));
    const body = await response.text();
    expect(response.status, body).toBe(200);
    const payload = JSON.parse(body) as { result?: Record<string, unknown>; error?: unknown };
    expect(payload.error).toBeUndefined();
    return payload.result ?? {};
}

const reviewer = `---
name: code-reviewer
description: Review code after changes
tools:
  - Read
disallowedTools:
  - Write
model: inherit
skills:
  - skill://review/SKILL.md
maxTurns: 12
---

Review code without modifying files.
`;

async function createFixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "mcpp-agent-resources-"));
    await Promise.all([
        mkdir(join(root, "code-reviewer")),
        mkdir(join(root, "wrong-name")),
        mkdir(join(root, "missing-description")),
    ]);
    await Promise.all([
        writeFile(join(root, "code-reviewer", "agent.md"), reviewer),
        writeFile(join(root, "wrong-name", "agent.md"), reviewer),
        writeFile(join(root, "missing-description", "agent.md"), "---\nname: missing-description\n---\nPrompt\n"),
    ]);
    return root;
}

describe("MCP Agent Resource 投影", () => {
    test("解析标准字段并拒绝非法名称与字段类型", () => {
        expect(isValidAgentName("code-reviewer")).toBe(true);
        expect(isValidAgentName("Code_Reviewer")).toBe(false);
        expect(parseAgentFrontmatter(reviewer)?.maxTurns).toBe(12);
        expect(parseAgentFrontmatter("---\nname: demo\ndescription: Demo\ntools: Read\n---\nPrompt\n")).toBeUndefined();
    });

    test("只扫描名称一致且有效的 agent.md", async () => {
        const root = await createFixture();
        try {
            const agents = await scanAgentsDir(root, { organizationPrefix: "peri.example" });
            expect(agents.map(({ name, uri, description }) => ({ name, uri, description }))).toEqual([{
                name: "code-reviewer",
                uri: "agent://peri.example/code-reviewer/agent.md",
                description: "Review code after changes",
            }]);
            expect(await readAgentResource(root, "wrong-name")).toBeUndefined();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("拒绝符号链接入口与超出大小限制的配置", async () => {
        const root = await createFixture();
        try {
            await mkdir(join(root, "linked"));
            await symlink(join(root, "code-reviewer", "agent.md"), join(root, "linked", "agent.md"));
            expect(await readAgentResource(root, "linked")).toBeUndefined();
            expect(await readAgentResource(root, "code-reviewer", { maxAgentBytes: 32 })).toBeUndefined();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("经 resources/list 与 resources/read 暴露 Agent", async () => {
        const root = await createFixture();
        const gateway = createGatewayRoutes([{
            path: "/agents/mcp",
            createServer: () => {
                const server = new McpServer({ name: "agent-fixture", version: "1" });
                ResourceForAgents(server, { agentsDir: root });
                return server;
            },
        }]);
        try {
            await request(gateway, "server/discover", {});
            const listed = await request(gateway, "resources/list", {});
            expect(listed.resources).toEqual([{
                uri: agentUri("code-reviewer"),
                name: "code-reviewer",
                description: "Review code after changes",
                mimeType: "text/markdown",
                size: Buffer.byteLength(reviewer),
                title: "MCP Agent",
            }]);

            const read = await request(gateway, "resources/read", { uri: agentUri("code-reviewer") });
            expect(read.contents).toEqual([{
                uri: agentUri("code-reviewer"),
                mimeType: "text/markdown",
                text: reviewer,
            }]);
        } finally {
            await gateway.close();
            await rm(root, { recursive: true, force: true });
        }
    });

    test("private cache 缺少授权上下文时拒绝挂载", () => {
        const server = new McpServer({ name: "agent-fixture", version: "1" });
        expect(() => ResourceForAgents(server, {
            agentsDir: "/tmp/agents",
            cacheScope: "private",
        })).toThrow("opaque authorization context");
    });
});
