/**
 * MCPP Cache 统一抽象。
 *
 * MCPP Response Cache 的 key 显式包含 origin、method、请求参数和 authorization
 * context，避免多 Server、多用户之间发生缓存串用。authorizationContext 只能是
 * 不可逆 opaque 标识，禁止传入 token、cookie 或其他凭据。
 */

export type McppCacheScope = "public" | "private";

export interface McppCacheKey {
    origin: string;
    method: string;
    params?: unknown;
    /** private scope 必填；必须是 opaque context id，而不是凭据本身。 */
    authorizationContext?: string;
}

export interface McppCacheEntry<T> {
    value: T;
    origin: string;
    method: string;
    scope: McppCacheScope;
    expiresAt?: number;
    stale: boolean;
    /** Server 声明的 opaque Server Cache Version；仅相等时可跨连接复用。 */
    cacheVersion?: string;
    /** Resource URI，用于 resources/updated 精确失效。 */
    resourceUri?: string;
}

export interface McppCacheGetOptions {
    /** 过期后是否允许读取 stale 副本；默认 false。 */
    allowStale?: boolean;
    /** 已与 Server 协商的 opaque Server Cache Version。 */
    cacheVersion?: string;
}

export interface McppCacheSetOptions {
    scope?: McppCacheScope;
    ttlMs?: number;
    resourceUri?: string;
    /** Server 声明的 opaque Server Cache Version。 */
    cacheVersion?: string;
}

type StoredEntry = McppCacheEntry<unknown> & { cacheKey: string };

function stableSerialize(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

function keyFor(key: McppCacheKey, scope: McppCacheScope): string {
    if (!key.origin || !key.method) throw new Error("MCPP cache key requires origin and method");
    if (scope === "private" && !key.authorizationContext) {
        throw new Error("MCPP private cache entries require an opaque authorization context");
    }
    return stableSerialize({
        origin: key.origin,
        method: key.method,
        params: key.params ?? null,
        authorizationContext: scope === "private" ? key.authorizationContext : undefined,
    });
}

/**
 * 进程内缓存。持久化、淘汰策略和容量限制由上层宿主决定；本实现负责 TTL、
 * stale 标记、scope 隔离及 MCP resource 通知对应的失效语义。
 */
export class McppCache {
    private readonly entries = new Map<string, StoredEntry>();
    private readonly now: () => number;

    public constructor(now: () => number = Date.now) {
        this.now = now;
    }

    public get<T>(key: McppCacheKey, options: McppCacheGetOptions = {}): T | undefined {
        const publicEntry = this.entries.get(keyFor(key, "public"));
        const entry = publicEntry ?? (
            key.authorizationContext
                ? this.entries.get(keyFor(key, "private"))
                : undefined
        );
        if (!entry) return undefined;
        const versionMatches = options.cacheVersion !== undefined && entry.cacheVersion === options.cacheVersion;
        if (options.cacheVersion !== undefined && !versionMatches) return undefined;
        const expired = entry.expiresAt !== undefined && this.now() >= entry.expiresAt;
        if ((entry.stale || (expired && !versionMatches)) && !options.allowStale) return undefined;
        return entry.value as T;
    }

    public set<T>(key: McppCacheKey, value: T, options: McppCacheSetOptions = {}): void {
        const scope = options.scope ?? "public";
        const ttlMs = options.ttlMs;
        if (ttlMs !== undefined && (!Number.isFinite(ttlMs) || ttlMs < 0)) {
            throw new Error("MCPP cache ttlMs must be a finite non-negative number");
        }
        if (ttlMs === 0) return;
        const cacheKey = keyFor(key, scope);
        this.entries.set(cacheKey, {
            cacheKey,
            value,
            origin: key.origin,
            method: key.method,
            scope,
            expiresAt: ttlMs === undefined ? undefined : this.now() + ttlMs,
            stale: false,
            cacheVersion: options.cacheVersion,
            resourceUri: options.resourceUri,
        });
    }

    public markOriginStale(origin: string, methods?: readonly string[]): void {
        for (const entry of this.entries.values()) {
            if (entry.origin === origin && (!methods || methods.includes(entry.method))) entry.stale = true;
        }
    }

    public markResourceStale(origin: string, resourceUri: string): void {
        for (const entry of this.entries.values()) {
            if (entry.origin === origin && entry.resourceUri === resourceUri) entry.stale = true;
        }
    }

    public clear(): void {
        this.entries.clear();
    }

    public get size(): number {
        return this.entries.size;
    }
}

export function createMcppCache(now?: () => number): McppCache {
    return new McppCache(now);
}
