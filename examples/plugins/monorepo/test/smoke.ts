/**
 * 聚合出口冒烟验证（MCPP 3.7）：单一 HTTP 出口下，/openspec/mcp 是独立
 * 的 MCP 端点，可被官方 client 连接并协商 skills 能力。
 *
 * 运行：bun test/smoke.ts
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { createStaticOpenspecServer } from "../openspec/static-server.ts";
import { createMonorepoGateway } from "../src/index.ts";
import { createMonorepoRoutesForOpenspec } from "../src/routes.ts";

async function requestCatalog<T extends z.ZodType>(
    client: Client,
    method: string,
    params: Record<string, unknown>,
    schema: T,
): Promise<z.output<T>> {
    return client.request({ method, params }, schema) as Promise<z.output<T>>;
}

const catalogListSchema = z.object({
    servers: z.array(z.object({
        id: z.string(),
        title: z.string(),
        entryDigest: z.string(),
    })),
});

const catalogGetSchema = z.object({
    server: z.object({
        id: z.string(),
        entryDigest: z.string(),
    }),
});

const catalogResolveSchema = z.object({
    serverId: z.string(),
    entryDigest: z.string(),
    endpoint: z.object({
        transport: z.literal("streamable-http"),
        endpointPath: z.string(),
    }),
});

async function connect(url: string): Promise<{ client: Client; close: () => Promise<void> }> {
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client(
        { name: "smoke", version: "1" },
        { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await client.connect(transport);
    return { client, close: () => client.close() };
}

async function main(): Promise<void> {
    const gw = await createMonorepoGateway({ host: "127.0.0.1", port: 0 });

    try {
        // 根路径是可人工检查的 Catalog demo，而非 MCP endpoint。
        const demo = await fetch(gw.url);
        if (demo.status !== 200) throw new Error(`Catalog demo 应返回 200，得到 ${demo.status}`);
        const html = await demo.text();
        if (
            !html.includes("https://cdn.tailwindcss.com") ||
            !html.includes("mcpp/servers/resolve") ||
            !html.includes("resources/list") ||
            !html.includes('id="skills"') ||
            !html.includes('id="normal-resources"') ||
            !html.includes("function partitionResources(items)") ||
            !html.includes("id=\"copy-url\"") ||
            !html.includes("id=\"copy-mcp-json\"") ||
            !html.includes('document.createElement("table")') ||
            !html.includes("bg-white text-slate-900") ||
            !html.includes("server-list-item-template") ||
            !html.includes('data-role="badges"') ||
            !html.includes("fragment.querySelector('[data-role=\"badges\"]')") ||
            !html.includes('resource.name || resource.title') ||
            !html.includes('cell.classList.add("whitespace-nowrap", "font-medium", "text-slate-950")') ||
            html.includes("server-card-template")
        ) {
            throw new Error("Catalog demo 未包含 CDN 样式、浅色列表、连接解析、Child MCP 资源表格或复制操作");
        }
        console.log("✓ GET /：Catalog HTML + Tailwind CDN demo 可访问");

        // 模拟 CDN demo 的无 SDK 直连：_meta 必须属于 params，不得放在 JSON-RPC 顶层。
        const browserCatalog = await fetch(gw.url + "/catalog/mcp", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                "MCP-Protocol-Version": "2026-07-28",
                "Mcp-Method": "mcpp/servers/list",
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "browser-demo",
                method: "mcpp/servers/list",
                params: {
                    _meta: {
                        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                        "io.modelcontextprotocol/clientInfo": { name: "browser-demo", version: "1" },
                        "io.modelcontextprotocol/clientCapabilities": {
                            extensions: { "io.mcpp/server-catalog": {} },
                        },
                    },
                },
            }),
        });
        const browserCatalogBody = await browserCatalog.json() as { result?: { servers?: unknown[] } };
        if (browserCatalog.status !== 200 || !browserCatalogBody.result?.servers?.length) {
            throw new Error("无 SDK 的浏览器 Catalog 请求失败");
        }
        console.log("✓ 浏览器直连：Catalog RPC 可由 CDN demo 正确发起");

        // 二级详情页直连 Child MCP：先协商，再只读取 tools/resources 元数据；不读取
        // resource 正文，更不会调用 Tool。OpenSpec 当前仅提供 Resources。
        const browserChildDiscover = await fetch(gw.url + "/openspec/mcp", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                "MCP-Protocol-Version": "2026-07-28",
                "Mcp-Method": "server/discover",
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "browser-child-discover",
                method: "server/discover",
                params: {
                    _meta: {
                        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                        "io.modelcontextprotocol/clientInfo": { name: "browser-demo", version: "1" },
                        "io.modelcontextprotocol/clientCapabilities": {},
                    },
                },
            }),
        });
        const browserChildDiscovery = await browserChildDiscover.json() as {
            result?: { capabilities?: { tools?: unknown; resources?: unknown } };
        };
        if (browserChildDiscover.status !== 200 || !browserChildDiscovery.result?.capabilities?.resources) {
            throw new Error("无 SDK 的浏览器 Child MCP 协商失败，或未声明 Resources");
        }
        if (browserChildDiscovery.result.capabilities.tools) {
            throw new Error("OpenSpec Child MCP 不应在未注册 Tools 时声明 tools capability");
        }

        const browserResources = await fetch(gw.url + "/openspec/mcp", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                "MCP-Protocol-Version": "2026-07-28",
                "Mcp-Method": "resources/list",
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "browser-child-resources",
                method: "resources/list",
                params: {
                    _meta: {
                        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                        "io.modelcontextprotocol/clientInfo": { name: "browser-demo", version: "1" },
                        "io.modelcontextprotocol/clientCapabilities": {},
                    },
                },
            }),
        });
        const browserResourcesBody = await browserResources.json() as {
            result?: { resources?: Array<{ uri?: unknown; name?: unknown; title?: unknown }> };
        };
        const browserSkillResources = browserResourcesBody.result?.resources ?? [];
        const firstBrowserResource = browserSkillResources[0];
        if (
            browserResources.status !== 200 ||
            browserSkillResources.length !== 13 ||
            firstBrowserResource?.name !== "openspec-apply-change" ||
            firstBrowserResource?.title !== "skill file" ||
            !browserSkillResources.some((resource) => (
                resource.uri === "skill://openspec-apply-change/references/workflow.md" &&
                resource.name === "references/workflow.md"
            ))
        ) {
            throw new Error("无 SDK 的浏览器 Child MCP Resources 列表或 Skill 附属 Resource 元数据不符合预期");
        }
        console.log("✓ 浏览器二级详情：Child MCP 协商后只读取 Tools/Resources 元数据");

        // Catalog 是独立的只读 MCP endpoint；解析不连接、不启动或 provision Child MCP。
        const catalog = await connect(gw.url + "/catalog/mcp");
        try {
            const listed = await requestCatalog(catalog.client, "mcpp/servers/list", {}, catalogListSchema);
            const entry = listed.servers.find((server) => server.id === "openspec");
            if (!entry) throw new Error("Catalog 未列出已挂载的 openspec Child MCP");

            const detail = await requestCatalog(
                catalog.client,
                "mcpp/servers/get",
                { serverId: entry.id },
                catalogGetSchema,
            );
            if (detail.server.entryDigest !== entry.entryDigest) {
                throw new Error("Catalog get 的条目摘要与 list 不一致");
            }

            const plan = await requestCatalog(
                catalog.client,
                "mcpp/servers/resolve",
                { serverId: entry.id, entryDigest: entry.entryDigest },
                catalogResolveSchema,
            );
            if (plan.endpoint.endpointPath !== "/openspec/mcp") {
                throw new Error(`Catalog resolve 返回了意外 endpoint '${plan.endpoint.endpointPath}'`);
            }

            let rejectedStaleDigest = false;
            try {
                await requestCatalog(
                    catalog.client,
                    "mcpp/servers/resolve",
                    { serverId: entry.id, entryDigest: "sha256:" + "0".repeat(64) },
                    catalogResolveSchema,
                );
            } catch {
                rejectedStaleDigest = true;
            }
            if (!rejectedStaleDigest) throw new Error("Catalog 必须拒绝未审阅的 entryDigest");
            console.log("✓ /catalog/mcp：list/get/resolve 只读可用，摘要变化被拒绝");
        } finally {
            await catalog.close();
        }

        // 端点：/openspec/mcp —— 12 个 OpenSpec Skill 根与其附属 Resource。
        const osp = await connect(gw.url + "/openspec/mcp");
        try {
            const res = await osp.client.listResources();
            const resources = res.resources ?? [];
            const skillRoots = resources.filter((resource) => resource.uri.endsWith("/SKILL.md"));
            if (skillRoots.length !== 12) {
                throw new Error(`/openspec/mcp 应投影到 12 个 Skill 根，得到 ${skillRoots.length}`);
            }
            if (!resources.some((resource) => resource.uri === "skill://openspec-apply-change/references/workflow.md")) {
                throw new Error("/openspec/mcp 未投影 openspec-apply-change 的 workflow.md 附属 Resource");
            }
            const doc = await osp.client.readResource({
                uri: "skill://openspec-explore/SKILL.md",
            });
            const text = (doc.contents?.[0] as { text?: string } | undefined)?.text ?? "";
            if (!text.includes("openspec-explore")) {
                throw new Error("SKILL.md 内容读取失败");
            }
            const reference = await osp.client.readResource({
                uri: "skill://openspec-apply-change/references/workflow.md",
            });
            const referenceText = (reference.contents?.[0] as { text?: string } | undefined)?.text ?? "";
            if (!referenceText.includes("Apply-change workflow reference")) {
                throw new Error("Skill 附属 Resource 内容读取失败");
            }
            console.log(`✓ /openspec/mcp：取得 ${skillRoots.length} 个 Skill 根与附属 Resource（SKILL.md/Reference 可读）`);
        } finally {
            await osp.close();
        }

        // 多会话：同一端点第二个客户端应能独立初始化（每会话独立 transport + server）
        const osp2 = await connect(gw.url + "/openspec/mcp");
        try {
            const res = await osp2.client.listResources();
            const skillRoots = res.resources?.filter((resource) => resource.uri.endsWith("/SKILL.md")) ?? [];
            if (skillRoots.length !== 12) {
                throw new Error("第二会话连接后 Skill 能力不可用");
            }
            console.log("✓ 多会话：同一端点第二个客户端可独立初始化");
        } finally {
            await osp2.close();
        }

        // 未匹配路径 → 404（挂载表必须可审计）
        const miss = await fetch(gw.url + "/nope", { method: "POST" });
        console.log(`✓ 未匹配路径 POST /nope → ${miss.status}`);
        if (miss.status !== 404) throw new Error("未匹配路径应 404");
    } finally {
        await gw.stop();
    }

    // Worker 形态：使用构建期 static registry，不经 Bun.serve，也不读取 skills 目录。
    // 0728 用 server/discover 作为现代协商入口；协议已不再返回 mcp-session-id。
    const routes = createMonorepoRoutesForOpenspec(createStaticOpenspecServer);
    try {
        const res = await routes.fetch(
            new Request("http://localhost/catalog/mcp", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                    "MCP-Protocol-Version": "2026-07-28",
                    "Mcp-Method": "server/discover",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "server/discover",
                    params: {
                        _meta: {
                            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                            "io.modelcontextprotocol/clientInfo": { name: "worker-smoke", version: "1" },
                            "io.modelcontextprotocol/clientCapabilities": {
                                extensions: { "io.mcpp/server-catalog": {} },
                            },
                        },
                    },
                }),
            }),
        );
        if (res.status !== 200) throw new Error(`纯 handler discover 应 200，得到 ${res.status}`);
        const body = await res.json() as { result?: { capabilities?: { extensions?: Record<string, unknown> } } };
        if (!body.result?.capabilities?.extensions?.["io.mcpp/server-catalog"]) {
            throw new Error("纯 handler 未声明 Server Catalog 扩展");
        }
        const workerResources = await routes.fetch(
            new Request("http://localhost/openspec/mcp", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                    "MCP-Protocol-Version": "2026-07-28",
                    "Mcp-Method": "resources/list",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 2,
                    method: "resources/list",
                    params: {
                        _meta: {
                            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                            "io.modelcontextprotocol/clientInfo": { name: "worker-smoke", version: "1" },
                            "io.modelcontextprotocol/clientCapabilities": {},
                        },
                    },
                }),
            }),
        );
        const workerResourcesBody = await workerResources.json() as {
            result?: { resources?: Array<{ uri?: unknown }> };
        };
        if (
            workerResources.status !== 200 ||
            !workerResourcesBody.result?.resources?.some((resource) => (
                resource.uri === "skill://openspec-apply-change/references/workflow.md"
            ))
        ) {
            throw new Error("Worker static registry 未暴露 Skill 附属 Resource");
        }
        const miss2 = await routes.fetch(new Request("http://localhost/nope"));
        if (miss2.status !== 404) throw new Error("纯 handler 未匹配路径应 404");
        console.log("✓ Worker 形态：纯 fetch handler 可发现 Catalog endpoint（无监听进程依赖）");
    } finally {
        await routes.close();
    }
}

await main();
console.log("\n✅ monorepo smoke finished");
process.exit(0);