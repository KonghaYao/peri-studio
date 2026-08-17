/**
 * Cloudflare Workers 部署入口 —— monorepo 聚合出口的 serverless 形态。
 *
 * 与本地 createMonorepoGateway 共用同一挂载表（MONOREPO_ROUTES）：
 *   /openspec/mcp 独立 MCP endpoint。
 *
 * 部署：
 *   bunx wrangler dev        # 本地预览（http://127.0.0.1:8787）
 *   bunx wrangler deploy     # 发布
 *
 * 注意：会话注册表为 isolate 内存态（单实例下可用）。生产多实例并发时
 * 会话可能落到不同 isolate，需外置会话状态（Durable Objects）。
 */
import { createMonorepoRoutes } from "./src/index.ts";

// 顶层单例：会话注册表随 isolate 生命周期存活，跨请求复用
const gateway = createMonorepoRoutes();

export default {
    fetch: gateway.fetch,
};
