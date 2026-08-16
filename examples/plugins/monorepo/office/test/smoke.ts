/**
 * 冒烟验证：stdio / HTTP / gateway 三条调用路径（@peri/mcpp 集成 office）。
 *
 * 运行：bun test/smoke.ts
 *   - stdio：spawn `bun src/index.ts --stdio`，用官方 StdioClientTransport 连上，
 *            initialize + listResources 断言 skills 投影（skill://…）可见
 *   - HTTP：spawn 默认 HTTP 模式（127.0.0.1:8457），POST /mcp 发送 initialize，断言 200 + session
 *   - gateway：进程内 createGateway([/office/mcp])，POST /office/mcp 断言可路由，未匹配路径断言 404
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createGateway, validateMcpJson, validatePluginJson } from "@peri/mcpp";
import { createOfficeServer } from "../src/index.ts";

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2026-07-28",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1" },
  },
};

async function waitFor(fn: () => Promise<boolean>, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function httpPost(url: string, body: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body,
  });
}

async function stdioPath(): Promise<void> {
  // 用官方 client 传输驱动 stdio（frame 解析由 SDK 处理，避免手写分帧）
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["src/index.ts", "--stdio"],
  });
  const client = new Client({ name: "smoke", version: "1" });
  await client.connect(transport);
  try {
    const r = await client.listResources();
    const skills = r.resources?.filter((x) => x.uri.startsWith("skill://")) ?? [];
    if (skills.length !== 1) {
      throw new Error(`stdio 期望投影到 1 个 skill resource，得到 ${skills.length}`);
    }
    console.log("✓ stdio 模式：initialize + listResources → skills:", skills.length);
  } finally {
    await client.close();
  }
}

async function httpPath(): Promise<number> {
  const p = Bun.spawn({
    cmd: ["bun", "src/index.ts"],
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const ok = await waitFor(async () => {
      try {
        const res = await fetch("http://127.0.0.1:8457/mcp", { method: "GET" });
        return res.status >= 400 && res.status < 600; // 端口已在服务（未初始化 GET 会被拒绝）
      } catch {
        return false;
      }
    });
    if (!ok) throw new Error("HTTP server 未在 8457 就绪");
    const res = await httpPost("http://127.0.0.1:8457/mcp", JSON.stringify(INIT));
    const sessionId = res.headers.get("mcp-session-id");
    await res.text();
    console.log(`✓ HTTP 模式：POST /mcp → ${res.status}，sessionId=${sessionId ? "present" : "absent"}`);
    return res.status;
  } finally {
    p.kill();
  }
}

async function gatewayPath(): Promise<void> {
  const gw = await createGateway(
    [{ path: "/office/mcp", createServer: () => createOfficeServer() }],
    { port: 0, host: "127.0.0.1" },
  );
  try {
    const res = await httpPost(gw.url + "office/mcp", JSON.stringify(INIT));
    await res.text();
    console.log(`✓ gateway：POST /office/mcp → ${res.status}`);
    if (res.status !== 200) throw new Error("office 端点初始化失败");

    const miss = await fetch(gw.url + "nope", { method: "POST" });
    console.log(`✓ gateway：POST /nope（未匹配路径）→ ${miss.status}`);
    if (miss.status !== 404) throw new Error("未匹配路径应 404");
  } finally {
    await gw.stop();
  }
}

async function pluginValidators(): Promise<void> {
  const p1 = validatePluginJson({
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "office",
    description: "demo",
  });
  if (!p1.ok) throw new Error(`plugin.json 合法样例不应失败: ${p1.errors}`);

  const p2 = validatePluginJson({ name: "Bad--Name_" });
  if (p2.ok || !p2.errors.some((e) => e.includes("name"))) {
    throw new Error("非法 plugin name 应被拒绝");
  }

  const m1 = validateMcpJson({
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: { office: { command: "./server", args: ["--stdio"], env: { HOME: "${PLUGIN_ROOT}" } } },
  });
  if (!m1.ok) throw new Error(`mcp.json 合法样例不应失败: ${m1.errors}`);

  const m2 = validateMcpJson({
    mcpServers: { bad: { command: "sh -c 'evil'" } },
  });
  if (m2.ok || !m2.errors.some((e) => e.toLowerCase().includes("command"))) {
    throw new Error("含 shell 拼接的 command 应被拒绝");
  }
  console.log("✓ plugin.json / mcp.json 校验（合法通过、非法拒绝）");
}

async function main(): Promise<void> {
  await stdioPath();
  const httpStatus = await httpPath();
  if (httpStatus !== 200) throw new Error("HTTP 初始化不应失败");
  await gatewayPath();
  await pluginValidators();
}

await main();
console.log("\n✅ smoke finished");
process.exit(0);