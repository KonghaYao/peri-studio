import { createCatalogPageHandler } from "@peri-code/mcpp/catalog";
import {
    createGatewayRoutes,
    type GatewayRoute,
    type GatewayRoutesHandle,
} from "@peri-code/mcpp/gateway";

/** OpenSpec Child MCP 的稳定挂载描述；本地与 Worker 形态共用。 */
export const OPENSPEC_CATALOG = {
    id: "openspec",
    title: "OpenSpec Recipes",
    description: "Workflow skills for proposing, applying, and verifying OpenSpec changes.",
    version: "1.0.0",
    tags: ["specification", "workflow"],
    capabilities: ["resources", "skills"],
    auth: { required: false },
} as const;

/** 将不同运行时的 OpenSpec server 实现挂载到同一个稳定 endpoint。 */
export function createOpenspecRoute(createServer: GatewayRoute["createServer"]): GatewayRoute {
    return {
        path: "/openspec/mcp",
        createServer,
        catalog: OPENSPEC_CATALOG,
    };
}

/** 以调用者提供的 Child factory 组装同一个 Catalog 与挂载表。 */
export function createMonorepoRoutesForOpenspec(
    createServer: GatewayRoute["createServer"],
): GatewayRoutesHandle {
    return createGatewayRoutes([createOpenspecRoute(createServer)], {
        catalog: {
            path: "/catalog/mcp",
            name: "mcpp-monorepo-catalog",
            version: "1.0.0",
        },
        fallback: createCatalogPageHandler(),
    });
}
