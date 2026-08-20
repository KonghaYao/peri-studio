/**
 * ResourceForSkills —— 把 skills/ 目录自动挂载为 MCP resources（MCPP 3.4 通道 B 的
 * 参考实现：实时 readdir 投影，新增 skill 无需重启 server）。
 *
 * 暴露入口（对应 S2/S3）：
 *   - `skill://{skillName}/SKILL.md` —— Skill 入口（text/markdown）
 *   - `skill://{skillName}/{relativePath}` —— Skill 根内任意受限附属文件
 *   - `resources/list` 经模板 list 回调枚举 Skill 入口与可安全公开的附属文件
 *
 * 挂载要点：list/read 不做启动期快照，每次访问实时 readdir + frontmatter 解析
 * + name 白名单校验（防路径穿越，S10 的文件不越界）。
 */
import {
    McpServer,
    ResourceTemplate,
    ResourceNotFoundError,
} from "@modelcontextprotocol/server";
import { isValidSkillName } from "../types.ts";
import { McppCache, type McppCacheScope } from "../cache.ts";
import {
    decodeSkillFilePath,
    firstTemplateVar,
} from "./skill-uri.ts";
import {
    readSkillResourceFile,
    scanSkillResourceFiles,
    type SkillResourceScanOptions,
} from "./skill-files.ts";

export interface ResourceForSkillsOptions {
    /** skills 目录（必传：SDK 不假定宿主仓库布局）。 */
    skillsDir: string;
    /** 资源名描述前缀，默认 "skill:{skillName}"。 */
    namePrefix?: string;
    /** Skill 根内普通文件的累计公开上限。 */
    resourceLimits?: SkillResourceScanOptions;
    /** 缓存所属 origin；未提供时使用 skillsDir 派生的稳定标识。 */
    origin?: string;
    /** MCP cacheScope；private 时必须同时提供 opaque authorizationContext。 */
    cacheScope?: McppCacheScope;
    authorizationContext?: string;
    /** Resource 响应的 TTL；未提供表示由宿主按需刷新。 */
    ttlMs?: number;
    cache?: McppCache;
}
/**
 * 挂载 skills 目录。
 *
 * @param server  目标 McpServer 实例
 * @param options skillsDir 必传；namePrefix 供前端展示用
 */
export function ResourceForSkills(
    server: McpServer,
    options: ResourceForSkillsOptions,
): void {
    const {
        skillsDir,
        namePrefix = "skill",
        resourceLimits,
        cache,
        origin = skillsDir,
        cacheScope = "public",
        authorizationContext,
        ttlMs = 30_000,
    } = options;
    if (cacheScope === "private" && !authorizationContext) {
        throw new Error("MCPP private Skill resource cache requires an opaque authorization context");
    }
    const descriptionFor = (name: string, d?: string) => d ?? `${namePrefix}:${name}`;
    const cacheKey = (method: string, params?: unknown) => ({
        origin,
        method,
        params,
        authorizationContext,
    });

    server.registerResource(
        "skill-file",
        new ResourceTemplate("skill://{skillName}/{+path}", {
            list: async () => {
                const key = cacheKey("resources/templates/list", { template: "skill://{skillName}/{+path}" });
                const cached = cache?.get<Awaited<ReturnType<typeof scanSkillResourceFiles>>>(key);
                const files = cached ?? await scanSkillResourceFiles(skillsDir, resourceLimits);
                if (!cached) cache?.set(key, files, { scope: cacheScope, ttlMs });
                return {
                    resources: files.map((file) => ({
                        uri: file.uri,
                        name: file.name,
                        description: file.kind === "skill"
                            ? descriptionFor(file.skillName, file.description)
                            : file.description,
                        mimeType: file.mimeType,
                        size: file.size,
                    })),
                };
            },
        }),
        {
            title: `${namePrefix} file`,
            description: "A safe-to-read file under a skill directory",
        },
        async (u, variables) => {
            const name = firstTemplateVar(variables.skillName);
            const rawPath = firstTemplateVar(variables.path);
            const relativePath = decodeSkillFilePath(rawPath);
            if (!isValidSkillName(name) || !relativePath) {
                throw new ResourceNotFoundError(u.href, "Invalid Skill resource URI");
            }

            const key = cacheKey("resources/read", { uri: u.href });
            const cached = cache?.get<Awaited<ReturnType<typeof readSkillResourceFile>>>(key);
            const resource = cached ?? await readSkillResourceFile(
                skillsDir,
                name,
                relativePath,
                resourceLimits,
            );
            if (!cached && resource) {
                cache?.set(key, resource, {
                    scope: cacheScope,
                    ttlMs,
                    resourceUri: u.href,
                });
            }
            if (!resource) {
                throw new ResourceNotFoundError(u.href, `Skill resource '${u.href}' not found`);
            }

            return {
                contents: [resource.contentKind === "text"
                    ? { uri: u.href, mimeType: resource.mimeType, text: resource.text ?? "" }
                    : { uri: u.href, mimeType: resource.mimeType, blob: resource.blob ?? "" }],
            };
        },
    );
}