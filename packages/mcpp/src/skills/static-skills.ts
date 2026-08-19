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
import { isValidSkillName } from "../types.ts";
import { decodeSkillFilePath, firstTemplateVar, skillFileUri } from "./skill-uri.ts";
import type { SkillResourceFile } from "./skill-files.ts";
import {
    classifySkillResourceFile,
    isPublicSkillResourcePath,
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
    /** 与实时扫描相同的公开目录与累计限制。 */
    resourceLimits?: SkillResourceScanOptions;
}

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
    const { limits, publicDirectories } = resolveSkillResourceOptions(resourceLimits);
    const candidates = new Map<string, StaticSkillResourceFile>();
    for (const resource of resources) {
        const relativePath = decodeSkillFilePath(resource.relativePath);
        if (
            !isValidSkillName(resource.skillName) ||
            !relativePath ||
            resource.relativePath !== relativePath ||
            !isPublicSkillResourcePath(relativePath, publicDirectories) ||
            resource.uri !== skillFileUri(resource.skillName, relativePath) ||
            (resource.contentKind !== "text" && resource.contentKind !== "blob") ||
            classifySkillResourceFile(relativePath)?.contentKind !== resource.contentKind ||
            classifySkillResourceFile(relativePath)?.mimeType !== resource.mimeType ||
            !Number.isSafeInteger(resource.size) ||
            resource.size < 0 ||
            !hasMatchingContent(resource)
        ) {
            continue;
        }
        const expectedKind = relativePath === "SKILL.md" ? "skill" : "file";
        if (resource.kind !== expectedKind) continue;
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
    const namePrefix = options.namePrefix ?? "skill";
    const index = indexStaticResources(options.resources, options.resourceLimits);

    server.registerResource(
        "static-skill-file",
        new ResourceTemplate("skill://{skillName}/{+path}", {
            list: () => ({
                resources: index.files.map((resource) => ({
                    uri: resource.uri,
                    name: resource.name,
                    description: resourceDescription(namePrefix, resource),
                    mimeType: resource.mimeType,
                    size: resource.size,
                })),
            }),
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
            const contents = resource.contentKind === "text"
                ? { uri: uri.href, mimeType: resource.mimeType, text: resource.text ?? "" }
                : { uri: uri.href, mimeType: resource.mimeType, blob: resource.blob ?? "" };
            return { contents: [contents] };
        },
    );
}

export type { SkillResourceContentKind };
