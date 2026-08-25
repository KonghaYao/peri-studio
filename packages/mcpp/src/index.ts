/**
 * @peri-code/mcpp —— MCPP (MCP Plus) 规范行为的参考实现（Server 侧）。
 *
 * 对应 MCPP 规范文档库（MCPP/）：
 *  - skills：resource 挂载、skill:// URI、frontmatter、digest（mcp-skills.md）
 *  - agents：agent.md 校验与 agent:// Resource 挂载（mcp-skills.md）
 *  - server：双模式启动（agent-plugin.md）
 *  - gateway：monorepo 多 server 聚合 HTTP 路径路由（mcp-mono-server.md）
 *  - plugin：plugin.json / mcp.json 校验（agent-plugin.md）
 */
export * from "./cache.ts";
export * from "./types.ts";
export * from "./skills/index.ts";
export * from "./agents/index.ts";
export * from "./server/index.ts";
export * from "./catalog.ts";
export * from "./gateway.ts";
export * from "./plugin/index.ts";