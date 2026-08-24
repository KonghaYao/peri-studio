import {
    McpServer,
    ResourceNotFoundError,
    ResourceTemplate,
} from "@modelcontextprotocol/server";
import { McppCache, type McppCacheScope } from "../cache.ts";
import { DEFAULT_MCPP_CACHE_TTL_MS } from "../server/defaults.ts";
import {
    agentUriTemplate,
    isValidAgentName,
    isValidAgentOrganizationPrefix,
} from "./agent.ts";
import {
    readAgentResource,
    scanAgentsDir,
    type AgentScanOptions,
} from "./scan.ts";

export interface ResourceForAgentsOptions extends AgentScanOptions {
    /** agents 目录；直接子目录名必须与 agent.md 的 name 一致。 */
    agentsDir: string;
    /** 缓存所属 origin；未提供时使用 agentsDir 派生的稳定标识。 */
    origin?: string;
    /** MCP cacheScope；private 时必须同时提供 opaque authorizationContext。 */
    cacheScope?: McppCacheScope;
    authorizationContext?: string;
    /** Resource 响应的 TTL；默认 1 天。 */
    ttlMs?: number;
    /** 已协商的 Server Cache Version。 */
    cacheVersion?: string;
    cache?: McppCache;
}

/** 将 agents/<name>/agent.md 实时投影为 agent:// MCP Resources。 */
export function ResourceForAgents(
    server: McpServer,
    options: ResourceForAgentsOptions,
): void {
    const {
        agentsDir,
        organizationPrefix,
        maxAgentBytes,
        cache,
        origin = agentsDir,
        cacheScope = "public",
        authorizationContext,
        ttlMs = DEFAULT_MCPP_CACHE_TTL_MS,
        cacheVersion,
    } = options;
    if (organizationPrefix !== undefined && !isValidAgentOrganizationPrefix(organizationPrefix)) {
        throw new Error("MCPP agent resources require a valid organizationPrefix");
    }
    if (cacheScope === "private" && !authorizationContext) {
        throw new Error("MCPP private Agent resource cache requires an opaque authorization context");
    }

    const template = agentUriTemplate(organizationPrefix);
    const scanOptions = { organizationPrefix, maxAgentBytes };
    const cacheKey = (method: string, params?: unknown) => ({
        origin,
        method,
        params,
        authorizationContext,
    });

    server.registerResource(
        "agent-config",
        new ResourceTemplate(template, {
            list: async () => {
                const key = cacheKey("resources/templates/list", { template });
                const cached = cache?.get<Awaited<ReturnType<typeof scanAgentsDir>>>(key, { cacheVersion });
                const agents = cached ?? await scanAgentsDir(agentsDir, scanOptions);
                if (!cached) cache?.set(key, agents, { scope: cacheScope, ttlMs, cacheVersion });
                return {
                    resources: agents.map((agent) => ({
                        uri: agent.uri,
                        name: agent.name,
                        description: agent.description,
                        mimeType: "text/markdown",
                        size: agent.size,
                    })),
                };
            },
        }),
        {
            title: "MCP Agent",
            description: "An untrusted subagent configuration that requires host approval before activation",
        },
        async (uri, variables) => {
            const rawName = variables.agentName;
            const agentName = Array.isArray(rawName) ? rawName[0] ?? "" : rawName ?? "";
            if (!isValidAgentName(agentName)) {
                throw new ResourceNotFoundError(uri.href, "Invalid Agent resource URI");
            }

            const key = cacheKey("resources/read", { uri: uri.href });
            const cached = cache?.get<Awaited<ReturnType<typeof readAgentResource>>>(key, { cacheVersion });
            const resource = cached ?? await readAgentResource(agentsDir, agentName, scanOptions);
            if (!cached && resource) {
                cache?.set(key, resource, {
                    scope: cacheScope,
                    ttlMs,
                    cacheVersion,
                    resourceUri: uri.href,
                });
            }
            if (!resource || resource.uri !== uri.href) {
                throw new ResourceNotFoundError(uri.href, `Agent resource '${uri.href}' not found`);
            }

            return { contents: [resource] };
        },
    );
}
