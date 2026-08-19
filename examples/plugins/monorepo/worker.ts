/**
 * Cloudflare Workers 部署入口 —— monorepo 聚合出口的 serverless 形态。
 *
 * 与本地 createMonorepoGateway 共用同一挂载表（MONOREPO_ROUTES）：
 *   /catalog/mcp 是只读 Server Catalog；/openspec/mcp 是独立 Child endpoint。
 *
 * 部署：
 *   bunx wrangler dev        # 本地预览（http://127.0.0.1:8457）
 *   bunx wrangler deploy     # 发布
 *
 * 注意：会话注册表为 isolate 内存态（单实例下可用）。生产多实例并发时
 * 会话可能落到不同 isolate，需外置会话状态（Durable Objects）。
 */
import { createStaticOpenspecServer } from "./openspec/static-server.ts";
import { createMonorepoRoutesForOpenspec } from "./src/routes.ts";

// 顶层单例：会话注册表随 isolate 生命周期存活，跨请求复用。
// Child 的 Skill 资源来自构建期 registry，不在 Worker 运行时读取本地目录。
const gateway = createMonorepoRoutesForOpenspec(createStaticOpenspecServer);

export default {
    fetch: gateway.fetch,
};
