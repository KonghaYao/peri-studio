/**
 * @peri/mcpp —— MCPP (MCP Plus) 规范行为的参考实现（Server 侧）。
 *
 * 对应 MCPP 规范（仓库根 MCPP.md）：
 *  - skills：resource 挂载、skill:// URI、frontmatter、digest（第 4 章，通道 B 投影）
 *  - server：双模式启动（3.1 承载）
 *  - gateway：monorepo 多 server 聚合 HTTP 路径路由（3.7）
 *  - plugin：plugin.json / mcp.json 校验（3.2 / 3.3）
 */
export * from "./types.ts";
export * from "./skills/index.ts";
export * from "./server/index.ts";
export * from "./gateway.ts";
export * from "./plugin/index.ts";