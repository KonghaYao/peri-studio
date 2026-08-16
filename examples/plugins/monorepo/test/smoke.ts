/**
 * 聚合出口冒烟验证（MCPP 3.7）：单一 HTTP 出口下，/office/mcp 与 /hello/mcp
 * 是各自独立的 MCP 端点，可被官方 client 分别连接并协商各自能力。
 *
 * 运行：bun test/smoke.ts
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMonorepoGateway } from "../src/index.ts";

async function connect(url: string): Promise<{ client: Client; close: () => Promise<void> }> {
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({ name: "smoke", version: "1" });
    await client.connect(transport);
    return { client, close: () => client.close() };
}

async function main(): Promise<void> {
    const gw = await createMonorepoGateway({ host: "127.0.0.1", port: 0 });

    try {
        // 端点 1：/office/mcp —— skills 投影 + office 工具
        const office = await connect(gw.url + "office/mcp");
        try {
            const res = await office.client.listResources();
            const skills = res.resources?.filter((r) => r.uri.startsWith("skill://")) ?? [];
            if (skills.length !== 1) {
                throw new Error(`/office/mcp 应投影到 1 个 skill，得到 ${skills.length}`);
            }
            const tools = await office.client.listTools();
            const names = (tools.tools ?? []).map((t) => t.name);
            if (!names.includes("anydoc") || !names.includes("notify_skill_changed")) {
                throw new Error(`/office/mcp 工具缺失：${names.join(", ")}`);
            }
            console.log(`✓ /office/mcp：独立取得 office 能力（skills: ${skills.length}，tools: ${names.join(", ")}）`);
        } finally {
            await office.close();
        }

        // 端点 2：/hello/mcp —— 只有 hello，与 office 互不干扰
        const hello = await connect(gw.url + "hello/mcp");
        try {
            const tools = await hello.client.listTools();
            const names = (tools.tools ?? []).map((t) => t.name);
            if (names.length !== 1 || names[0] !== "hello") {
                throw new Error(`/hello/mcp 应只有 hello tool，得到 ${names.join(", ")}`);
            }
            console.log(`✓ /hello/mcp：独立取得 hello 能力（tools: ${names.join(", ")}）`);
        } finally {
            await hello.close();
        }

        // 端点 3：/openspec/mcp —— 第三方 OpenSpec skills 集（12 个 openspec-*）
        const osp = await connect(gw.url + "openspec/mcp");
        try {
            const res = await osp.client.listResources();
            const skills = res.resources?.filter((r) => r.uri.startsWith("skill://")) ?? [];
            if (skills.length !== 12) {
                throw new Error(`/openspec/mcp 应投影到 12 个 skill，得到 ${skills.length}`);
            }
            const doc = await osp.client.readResource({
                uri: "skill://openspec-explore/SKILL.md",
            });
            const text = (doc.contents?.[0] as { text?: string } | undefined)?.text ?? "";
            if (!text.includes("openspec-explore")) {
                throw new Error("SKILL.md 内容读取失败");
            }
            console.log(`✓ /openspec/mcp：独立取得 openspec skills（skills: ${skills.length}，SKILL.md 可读）`);
        } finally {
            await osp.close();
        }

        // 多会话：同一端点第二个客户端应能独立初始化（每会话独立 transport + server）
        const office2 = await connect(gw.url + "office/mcp");
        try {
            const tools = await office2.client.listTools();
            if (!((tools.tools ?? []).some((t) => t.name === "anydoc"))) {
                throw new Error("第二会话连接后能力不可用");
            }
            console.log("✓ 多会话：同一端点第二个客户端可独立初始化");
        } finally {
            await office2.close();
        }

        // 未匹配路径 → 404（挂载表必须可审计）
        const miss = await fetch(gw.url + "nope", { method: "POST" });
        console.log(`✓ 未匹配路径 POST /nope → ${miss.status}`);
        if (miss.status !== 404) throw new Error("未匹配路径应 404");
    } finally {
        await gw.stop();
    }
}

await main();
console.log("\n✅ monorepo smoke finished");
process.exit(0);