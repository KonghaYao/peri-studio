import type { McpRequestContext, McpServer, McpServerFactory, ServerCapabilities } from "@modelcontextprotocol/server";
import { McppCache, type McppCacheScope } from "../cache.ts";
import {
    MCPP_SERVER_CACHE_VERSION_EXTENSION,
    serverCacheVersionCapability,
} from "../types.ts";

import { DEFAULT_MCPP_CACHE_TTL_MS } from "./defaults.ts";

export type McppCacheVersionValue =
    | null
    | boolean
    | number
    | string
    | McppCacheVersionValue[]
    | { [key: string]: McppCacheVersionValue };

/** Server Cache Version 计算输入；应覆盖全部声明可缓存的状态。 */
export interface McppCacheVersionSnapshot {
    /** 修改规范化结构时必须递增，避免不同算法产生相同语义假设。 */
    schemaVersion?: string;
    tools?: McppCacheVersionValue;
    prompts?: McppCacheVersionValue;
    resources?: McppCacheVersionValue;
    resourceTemplates?: McppCacheVersionValue;
    skills?: McppCacheVersionValue;
    /** Resource URI 到内容 digest 的映射；不建议直接传入大文件正文。 */
    resourceContentDigests?: Record<string, string>;
    /** 其他声明可缓存的状态。 */
    extensions?: Record<string, McppCacheVersionValue>;
}

function canonicalCacheVersionValue(value: unknown, ancestors: Set<object>): string {
    if (value === null || typeof value === "boolean" || typeof value === "string") {
        return JSON.stringify(value);
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error("MCPP cache version snapshot requires finite numbers");
        return JSON.stringify(value);
    }
    if (typeof value !== "object") {
        throw new Error("MCPP cache version snapshot must contain only JSON-compatible values");
    }
    if (ancestors.has(value)) throw new Error("MCPP cache version snapshot must not contain cycles");
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return `[${value.map((item) => canonicalCacheVersionValue(item, ancestors)).join(",")}]`;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new Error("MCPP cache version snapshot requires plain objects");
        }
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).sort().map((key) => {
            const item = record[key];
            if (item === undefined) {
                throw new Error("MCPP cache version snapshot must not contain undefined");
            }
            return `${JSON.stringify(key)}:${canonicalCacheVersionValue(item, ancestors)}`;
        }).join(",")}}`;
    } finally {
        ancestors.delete(value);
    }
}

/**
 * 对可缓存状态进行确定性规范化并计算 SHA-256 Server Cache Version。
 * 数组顺序具有语义；对象键、Resource URI 和 extension id 会稳定排序。
 */
export async function createCacheVersion(snapshot: McppCacheVersionSnapshot): Promise<string> {
    const canonical = canonicalCacheVersionValue(snapshot, new Set());
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `sha256:${hex}`;
}

export interface McppServerCacheOptions {
    /** Server Cache Version；可缓存状态变化时必须改变。 */
    cacheVersion: string;
    /** 默认 1 天；设为 0 可禁用条目写入。 */
    ttlMs?: number;
    scope?: McppCacheScope;
    /** private scope 必填；必须是 opaque context id，禁止传入凭据。 */
    authorizationContext?: (context: McpRequestContext) => string | undefined;
    /** 可注入持久化或定制缓存；默认使用进程内 McppCache。 */
    cache?: McppCache;
}

export interface McppServerCacheContext {
    cache: McppCache;
    cacheVersion: string;
    ttlMs: number;
    cacheScope: McppCacheScope;
    authorizationContext?: string;
    /** 传给 McpServer 构造器 options.capabilities。 */
    capabilities: ServerCapabilities;
    /** 传给 ResourceForSkills / ResourceForStaticSkills。 */
    resourceCache: {
        cache: McppCache;
        cacheVersion: string;
        ttlMs: number;
        cacheScope: McppCacheScope;
        authorizationContext?: string;
    };
}

export type McppServerBuilder = (
    context: McpRequestContext,
    mcpp: McppServerCacheContext,
) => McpServer | Promise<McpServer>;

/**
 * 创建带默认 MCPP Cache 的 Server factory。
 *
 * cache 位于请求级 McpServer 实例之外，因此 HTTP 模式可跨请求复用 MCPP Response
 * Cache 与 Resource Content Cache。调用方应把 capabilities 传入 McpServer 构造器，
 * 并把 resourceCache 传给 Resource 挂载器。
 */
export function createMcppServerFactory(
    options: McppServerCacheOptions,
    build: McppServerBuilder,
): McpServerFactory {
    const cache = options.cache ?? new McppCache();
    const ttlMs = options.ttlMs ?? DEFAULT_MCPP_CACHE_TTL_MS;
    const cacheScope = options.scope ?? "public";
    const capability = serverCacheVersionCapability(options.cacheVersion);

    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
        throw new Error("MCPP server cache ttlMs must be a finite non-negative number");
    }

    return (context) => {
        const authorizationContext = options.authorizationContext?.(context);
        if (cacheScope === "private" && !authorizationContext) {
            throw new Error("MCPP private server cache requires an opaque authorization context");
        }
        const mcpp: McppServerCacheContext = {
            cache,
            cacheVersion: capability.cacheVersion,
            ttlMs,
            cacheScope,
            authorizationContext,
            capabilities: {
                extensions: {
                    [MCPP_SERVER_CACHE_VERSION_EXTENSION]: capability,
                },
            },
            resourceCache: {
                cache,
                cacheVersion: capability.cacheVersion,
                ttlMs,
                cacheScope,
                authorizationContext,
            },
        };
        return build(context, mcpp);
    };
}
