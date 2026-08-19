/**
 * MCPP Server Catalog —— monorepo HTTP 挂载的只读发现与连接解析。
 *
 * Catalog 仅从启动期静态 mount 表派生条目。它不接受、也不定义包下载、安装、
 * 本地命令、子进程启动、运行实例创建或 provision 操作；实际能力仍由独立的
 * Child MCP endpoint 在连接后按标准 MCP 提供。
 */
import {
    McpServer,
    ProtocolError,
    ProtocolErrorCode,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { computeDigest } from "./skills/digest.ts";

export {
    createCatalogPageHandler,
    DEFAULT_CATALOG_ENDPOINT_PATH,
    DEFAULT_CATALOG_PAGE_PATH,
    renderCatalogPage,
    type CatalogPageOptions,
} from "./catalog-page.ts";

/** MCPP Server Catalog 扩展标识。 */
export const MCPP_SERVER_CATALOG_EXTENSION = "io.mcpp/server-catalog";

/** Catalog 内可摘要声明的标准 MCP 能力类别。 */
export const CATALOG_CAPABILITIES = ["tools", "resources", "skills"] as const;
export type CatalogCapability = (typeof CATALOG_CAPABILITIES)[number];

export interface CatalogAuthorization {
    /** Child endpoint 是否要求认证；这不是凭据、凭据引用或授权授予。 */
    required: boolean;
}

/**
 * 静态挂载的可发现描述。endpointPath 由 GatewayRoute.path 派生，调用方不能
 * 在此对象中指定任意 URL，因而 Catalog 不会成为跨 origin 连接引导面。
 */
export interface ServerCatalogEntry {
    /** 稳定且可审计的 server 标识，例如 "com.acme.office"。 */
    id: string;
    title: string;
    description: string;
    version: string;
    tags?: readonly string[];
    capabilities?: readonly CatalogCapability[];
    auth?: CatalogAuthorization;
}

/** 可挂载的 Catalog endpoint 自身的展示身份。 */
export interface ServerCatalogOptions {
    name?: string;
    version?: string;
    instructions?: string;
}

type ResolvedServerCatalogEntry = {
    id: string;
    title: string;
    description: string;
    version: string;
    tags: string[];
    capabilities: CatalogCapability[];
    auth: CatalogAuthorization;
    endpointPath: string;
    entryDigest: string;
};

type CatalogEntryInput = ServerCatalogEntry & { endpointPath: string };

const SERVER_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/;
const ENDPOINT_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]*$/;

const listParams = z.object({
    cursor: z.string().min(1).optional(),
    query: z.string().trim().min(1).max(256).optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
    capabilities: z.array(z.enum(CATALOG_CAPABILITIES)).max(CATALOG_CAPABILITIES.length).optional(),
}).strict();

const getParams = z.object({
    serverId: z.string().min(1).max(128),
}).strict();

const resolveParams = getParams.extend({
    entryDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
}).strict();

function sortedUnique(values: readonly string[] | undefined): string[] {
    return [...new Set(values ?? [])].sort((left, right) => left.localeCompare(right));
}

function sortedCapabilities(values: readonly CatalogCapability[] | undefined): CatalogCapability[] {
    const supported = new Set(CATALOG_CAPABILITIES);
    const unique = new Set<CatalogCapability>();
    for (const value of values ?? []) {
        if (!supported.has(value)) {
            throw new Error(`MCPP catalog: unsupported capability '${value}'`);
        }
        unique.add(value);
    }
    return CATALOG_CAPABILITIES.filter((capability) => unique.has(capability));
}

function validateEntry(entry: CatalogEntryInput): Omit<ResolvedServerCatalogEntry, "entryDigest"> {
    if (!SERVER_ID.test(entry.id)) {
        throw new Error(`MCPP catalog: invalid server id '${entry.id}'`);
    }
    if (!entry.title.trim() || !entry.description.trim() || !entry.version.trim()) {
        throw new Error(`MCPP catalog: server '${entry.id}' requires title, description, and version`);
    }
    if (
        !ENDPOINT_PATH.test(entry.endpointPath) ||
        entry.endpointPath.split("/").some((segment) => segment === "." || segment === "..")
    ) {
        throw new Error(`MCPP catalog: invalid endpoint path '${entry.endpointPath}'`);
    }

    return {
        id: entry.id,
        title: entry.title.trim(),
        description: entry.description.trim(),
        version: entry.version.trim(),
        tags: sortedUnique(entry.tags),
        capabilities: sortedCapabilities(entry.capabilities),
        auth: { required: entry.auth?.required ?? false },
        endpointPath: entry.endpointPath,
    };
}

async function resolveEntries(entries: readonly CatalogEntryInput[]): Promise<ResolvedServerCatalogEntry[]> {
    const seenIds = new Set<string>();
    const seenPaths = new Set<string>();
    const result: ResolvedServerCatalogEntry[] = [];

    for (const entry of entries) {
        const value = validateEntry(entry);
        if (seenIds.has(value.id)) {
            throw new Error(`MCPP catalog: duplicate server id '${value.id}'`);
        }
        if (seenPaths.has(value.endpointPath)) {
            throw new Error(`MCPP catalog: duplicate endpoint path '${value.endpointPath}'`);
        }
        seenIds.add(value.id);
        seenPaths.add(value.endpointPath);
        result.push({
            ...value,
            entryDigest: await computeDigest(JSON.stringify(value)),
        });
    }

    return result.sort((left, right) => left.id.localeCompare(right.id));
}

function toListEntry(entry: ResolvedServerCatalogEntry): Omit<ResolvedServerCatalogEntry, "endpointPath"> {
    const { endpointPath: _endpointPath, ...value } = entry;
    return value;
}

function findEntry(
    entries: readonly ResolvedServerCatalogEntry[],
    serverId: string,
): ResolvedServerCatalogEntry {
    const entry = entries.find((candidate) => candidate.id === serverId);
    if (!entry) {
        throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            `Catalog server '${serverId}' was not found`,
        );
    }
    return entry;
}

function matches(
    entry: ResolvedServerCatalogEntry,
    query: string | undefined,
    tags: readonly string[] | undefined,
    capabilities: readonly CatalogCapability[] | undefined,
): boolean {
    const normalizedQuery = query?.toLocaleLowerCase();
    if (normalizedQuery) {
        const searchable = [entry.id, entry.title, entry.description, ...entry.tags]
            .join("\n")
            .toLocaleLowerCase();
        if (!searchable.includes(normalizedQuery)) return false;
    }
    if (tags?.some((tag) => !entry.tags.includes(tag))) return false;
    if (capabilities?.some((capability) => !entry.capabilities.includes(capability))) return false;
    return true;
}

function parseCursor(cursor: string | undefined, total: number): number {
    if (!cursor) return 0;
    const offset = Number(cursor);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= total) {
        throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Catalog cursor is invalid");
    }
    return offset;
}

/**
 * 创建只读 Catalog MCP Server。调用方必须提供来自实际 Gateway mount 表的路径；
 * 此函数没有能够安装、启动或 provision Server 的参数或回调。
 */
export async function createServerCatalog(
    entries: readonly CatalogEntryInput[],
    options: ServerCatalogOptions = {},
): Promise<McpServer> {
    const resolvedEntries = await resolveEntries(entries);
    const server = new McpServer(
        {
            name: options.name ?? "mcpp-server-catalog",
            version: options.version ?? "1.0.0",
        },
        {
            capabilities: {
                extensions: {
                    [MCPP_SERVER_CATALOG_EXTENSION]: {},
                },
            },
            instructions: options.instructions ??
                "Lists static Child MCP endpoints and resolves an approved catalog entry. " +
                "It does not install, launch, provision, or proxy servers.",
        },
    );

    server.server.setRequestHandler(
        "mcpp/servers/list",
        { params: listParams },
        (params) => {
            const filtered = resolvedEntries.filter((entry) =>
                matches(entry, params.query, params.tags, params.capabilities)
            );
            const offset = parseCursor(params.cursor, filtered.length);
            const pageSize = 50;
            const page = filtered.slice(offset, offset + pageSize).map(toListEntry);
            const nextOffset = offset + page.length;
            return {
                servers: page,
                ...(nextOffset < filtered.length ? { nextCursor: String(nextOffset) } : {}),
            };
        },
    );

    server.server.setRequestHandler(
        "mcpp/servers/get",
        { params: getParams },
        (params) => ({ server: toListEntry(findEntry(resolvedEntries, params.serverId)) }),
    );

    server.server.setRequestHandler(
        "mcpp/servers/resolve",
        { params: resolveParams },
        (params) => {
            const entry = findEntry(resolvedEntries, params.serverId);
            if (entry.entryDigest !== params.entryDigest) {
                throw new ProtocolError(
                    ProtocolErrorCode.InvalidParams,
                    "Catalog entry has changed; refresh it and obtain explicit approval again",
                );
            }
            return {
                serverId: entry.id,
                entryDigest: entry.entryDigest,
                version: entry.version,
                endpoint: {
                    transport: "streamable-http",
                    endpointPath: entry.endpointPath,
                },
                auth: entry.auth,
            };
        },
    );

    return server;
}
