/**
 * ResourceForSkills —— 把 skills/ 目录自动挂载为 MCP resources（MCPP 3.4 通道 B 的
 * 参考实现：实时 readdir 投影，新增 skill 无需重启 server）。
 *
 * 暴露入口（对应 S2/S3）：
 *   - `skill://{skillName}/SKILL.md` —— Skill 入口（text/markdown）
 *   - `skill://{skillName}/{relativePath}` —— references/scripts/assets 等受限附属文件
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
    /** 附属文件的默认公开目录、类型、单文件和累计公开上限。 */
    resourceLimits?: SkillResourceScanOptions;
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
    const { skillsDir, namePrefix = "skill", resourceLimits } = options;
    const descriptionFor = (name: string, d?: string) => d ?? `${namePrefix}:${name}`;

    server.registerResource(
        "skill-file",
        new ResourceTemplate("skill://{skillName}/{+path}", {
            list: async () => {
                const files = await scanSkillResourceFiles(skillsDir, resourceLimits);
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

            const resource = await readSkillResourceFile(
                skillsDir,
                name,
                relativePath,
                resourceLimits,
            );
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