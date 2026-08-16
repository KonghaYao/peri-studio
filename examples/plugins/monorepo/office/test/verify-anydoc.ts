/**
 * 临时验证脚本：InMemoryTransport 进程内调用修复后的 anydoc 工具，
 * 验证 SDK 输出校验通过 + 真实文档转换成功。
 * 运行：bun verify-anydoc.ts
 */
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { createOfficeServer } from "../src/index.ts";

const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
await createOfficeServer().connect(serverTransport);
const client = new Client({ name: "verify-anydoc", version: "0.1.0" });
await client.connect(clientTransport);

console.log("\n▶ tools/call anydoc <sample.csv>");
const res = await client.callTool({
  name: "anydoc",
  arguments: { args: `${import.meta.dir}/sample.csv` },
});
console.log(JSON.stringify(res, null, 2));
process.exit(0);