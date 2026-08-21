/**
 * 可静态打包的 Skill Resource 投影。
 *
 * Worker 等没有运行时本地文件系统的环境应在构建阶段生成资源表，再使用本模块
 * 挂载。生成产物只包含已经过受限扫描和内容校验的文件；SKILL.md 仍是唯一的
 * Skill 根，附属文件不会单独成为 Skill。
 */
import {
    McpServer,
    ResourceNotFoundError,
    ResourceTemplate,
} from "@modelcontextprotocol/server";
import { McppCache, type McppCacheScope } from "../cache.ts";
import { DEFAULT_MCPP_CACHE_TTL_MS } from "../server/defaults.ts";
import { isValidSkillName } from "../types.ts";
import { decodeSkillFilePath, firstTemplateVar, skillFileUri } from "./skill-uri.ts";
import type { SkillResourceFile } from "./skill-files.ts";
import {
    classifySkillResourceFile,
    resolveSkillResourceOptions,
    type SkillResourceContentKind,
    type SkillResourceScanOptions,
} from "./resource-policy.ts";

export interface StaticSkillResourceFile extends SkillResourceFile {
    /** text Resource 的 UTF-8 正文。 */
    text?: string;
    /** blob Resource 的 base64 正文。 */
    blob?: string;
}

export interface ResourceForStaticSkillsOptions {
    /** 构建期生成、随 bundle 一同部署的 Skill Resource 表。 */
    resources: readonly StaticSkillResourceFile[];
    /** 资源名描述前缀，默认 "skill"。 */
    namePrefix?: string;
    /** 与实时扫描相同的累计限制。 */
    resourceLimits?: SkillResourceScanOptions;
    /** 缓存所属 origin；未提供时不复用跨 Server 实例的缓存。 */
    origin?: string;
    /** MCP cacheScope；private 时必须同时提供 opaque authorizationContext。 */
    cacheScope?: McppCacheScope;
    authorizationContext?: string;
    /** Resource 响应的 TTL；默认 1 天。 */
    ttlMs?: number;
    /** 已协商的 Server Cache Version。 */
    cacheVersion?: string;
    /** 由宿主在 Server factory 外创建，以跨请求复用。 */
    cache?: McppCache;
}

type StaticSkillListResponse = {
    resources: Array<{
        uri: string;
        name: string;
        description: string;
        mimeType: string;
        size: number;
    }>;
};

type StaticSkillReadResponse = {
    contents: Array<
        | { uri: string; mimeType: string; text: string }
        | { uri: string; mimeType: string; blob: string }
    >;
};

type StaticResourceIndex = {
    files: StaticSkillResourceFile[];
    byKey: Map<string, StaticSkillResourceFile>;
};

function resourceKey(skillName: string, relativePath: string): string {
    return `${skillName}\u0000${relativePath}`;
}

function utf8Size(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

function blobSize(value: string): number | undefined {
    try {
        return atob(value).length;
    } catch {
        return undefined;
    }
}

function hasMatchingContent(resource: StaticSkillResourceFile): boolean {
    if (resource.contentKind === "text") {
        return typeof resource.text === "string" && resource.blob === undefined && utf8Size(resource.text) === resource.size;
    }
    return typeof resource.blob === "string" && resource.text === undefined && blobSize(resource.blob) === resource.size;
}

function compareResources(left: StaticSkillResourceFile, right: StaticSkillResourceFile): number {
    const bySkill = left.skillName.localeCompare(right.skillName);
    if (bySkill !== 0) return bySkill;
    if (left.relativePath === "SKILL.md") return -1;
    if (right.relativePath === "SKILL.md") return 1;
    return left.relativePath.localeCompare(right.relativePath);
}

/**
 * 校验并规范化构建期资源表。无效条目会被忽略；没有根 SKILL.md 的附属文件
 * 必须不可见，避免不完整或被手工篡改的 registry 形成孤儿 Resource。
 */
export function createStaticSkillResources(
    resources: readonly StaticSkillResourceFile[],
    resourceLimits?: SkillResourceScanOptions,
): StaticSkillResourceFile[] {
    const { limits } = resolveSkillResourceOptions(resourceLimits);
    const candidates = new Map<string, StaticSkillResourceFile>();
    for (const resource of resources) {
        const relativePath = decodeSkillFilePath(resource.relativePath);
        if (
            !isValidSkillName(resource.skillName) ||
            !relativePath ||
            resource.relativePath !== relativePath ||
            resource.uri !== skillFileUri(resource.skillName, relativePath) ||
            (resource.contentKind !== "text" && resource.contentKind !== "blob") ||
            classifySkillResourceFile(relativePath, resource.contentKind).contentKind !== resource.contentKind ||
            classifySkillResourceFile(relativePath, resource.contentKind).mimeType !== resource.mimeType ||
            !Number.isSafeInteger(resource.size) ||
            resource.size < 0 ||
            !hasMatchingContent(resource)
        ) {
            continue;
        }
        const expectedKind = relativePath === "SKILL.md" ? "skill" : "file";
        if (resource.kind !== expectedKind || (expectedKind === "skill" && resource.contentKind !== "text")) continue;
        candidates.set(resourceKey(resource.skillName, relativePath), { ...resource, relativePath });
    }

    const roots = new Set<string>();
    const candidatesBySkill = new Map<string, StaticSkillResourceFile[]>();
    for (const resource of candidates.values()) {
        if (resource.relativePath === "SKILL.md") roots.add(resource.skillName);
        const files = candidatesBySkill.get(resource.skillName) ?? [];
        files.push(resource);
        candidatesBySkill.set(resource.skillName, files);
    }

    let totalFiles = 0;
    let totalBytes = 0;
    const accepted: StaticSkillResourceFile[] = [];
    for (const skillName of [...candidatesBySkill.keys()].sort((left, right) => left.localeCompare(right))) {
        if (!roots.has(skillName) || totalFiles >= limits.maxTotalFiles || totalBytes >= limits.maxTotalBytes) continue;
        const skillFiles = candidatesBySkill.get(skillName)!.sort(compareResources);
        const root = skillFiles.find((resource) => resource.relativePath === "SKILL.md");
        if (!root || root.size > limits.maxFileBytes || root.size > limits.maxSkillBytes || totalBytes + root.size > limits.maxTotalBytes) {
            continue;
        }

        let skillFilesCount = 0;
        let skillBytes = 0;
        for (const resource of skillFiles) {
            if (
                resource.size > limits.maxFileBytes ||
                skillFilesCount >= limits.maxSkillFiles ||
                skillBytes + resource.size > limits.maxSkillBytes ||
                totalFiles >= limits.maxTotalFiles ||
                totalBytes + resource.size > limits.maxTotalBytes
            ) {
                continue;
            }
            accepted.push(resource);
            skillFilesCount += 1;
            skillBytes += resource.size;
            totalFiles += 1;
            totalBytes += resource.size;
        }
    }
    return accepted;
}

function indexStaticResources(
    resources: readonly StaticSkillResourceFile[],
    resourceLimits?: SkillResourceScanOptions,
): StaticResourceIndex {
    const files = createStaticSkillResources(resources, resourceLimits);
    return {
        files,
        byKey: new Map(files.map((resource) => [resourceKey(resource.skillName, resource.relativePath), resource])),
    };
}

function resourceDescription(namePrefix: string, resource: StaticSkillResourceFile): string {
    if (resource.kind === "file") return resource.description ?? `Skill file: ${resource.relativePath}`;
    return resource.description ?? `${namePrefix}:${resource.skillName}`;
}

/**
 * 将构建期生成的资源表挂载为 MCP Resource。运行时绝不读取宿主目录，适用于
 * Cloudflare Worker 等无本地文件系统环境。
 */
export function ResourceForStaticSkills(
    server: McpServer,
    options: ResourceForStaticSkillsOptions,
): void {
    const {
        namePrefix = "skill",
        resourceLimits,
        cache,
        origin,
        cacheScope = "public",
        authorizationContext,
        ttlMs = DEFAULT_MCPP_CACHE_TTL_MS,
        cacheVersion,
    } = options;
    if (cacheScope === "private" && !authorizationContext) {
        throw new Error("MCPP private static Skill resource cache requires an opaque authorization context");
    }
    const index = indexStaticResources(options.resources, resourceLimits);
    const cacheKey = (method: string, params?: unknown) => ({
        origin: origin!,
        method,
        params,
        authorizationContext,
    });

    server.registerResource(
        "static-skill-file",
        new ResourceTemplate("skill://{skillName}/{+path}", {
            list: () => {
                const key = origin ? cacheKey("resources/templates/list", { template: "skill://{skillName}/{+path}" }) : undefined;
                const cached = key ? cache?.get<StaticSkillListResponse>(key, { cacheVersion }) : undefined;
                if (cached) return cached;
                const response: StaticSkillListResponse = {
                    resources: index.files.map((resource) => ({
                        uri: resource.uri,
                        name: resource.name,
                        description: resourceDescription(namePrefix, resource),
                        mimeType: resource.mimeType,
                        size: resource.size,
                    })),
                };
                if (key) cache?.set(key, response, { scope: cacheScope, ttlMs, cacheVersion });
                return response;
            },
        }),
        {
            title: `${namePrefix} file`,
            description: "A build-time bundled file under a skill directory",
        },
        async (uri, variables) => {
            const skillName = firstTemplateVar(variables.skillName);
            const relativePath = decodeSkillFilePath(firstTemplateVar(variables.path));
            if (!isValidSkillName(skillName) || !relativePath) {
                throw new ResourceNotFoundError(uri.href, "Invalid Skill resource URI");
            }
            const resource = index.byKey.get(resourceKey(skillName, relativePath));
            if (!resource) {
                throw new ResourceNotFoundError(uri.href, `Skill resource '${uri.href}' not found`);
            }
            const key = origin ? cacheKey("resources/read", { uri: uri.href }) : undefined;
            const cached = key ? cache?.get<StaticSkillReadResponse>(key, { cacheVersion }) : undefined;
            if (cached) return cached;
            const contents = resource.contentKind === "text"
                ? { uri: uri.href, mimeType: resource.mimeType, text: resource.text ?? "" }
                : { uri: uri.href, mimeType: resource.mimeType, blob: resource.blob ?? "" };
            const response: StaticSkillReadResponse = { contents: [contents] };
            if (key) cache?.set(key, response, {
                scope: cacheScope,
                ttlMs,
                cacheVersion,
                resourceUri: uri.href,
            });
            return response;
        },
    );
}

export type { SkillResourceContentKind };
