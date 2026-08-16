/**
 * ResourceForSkills —— 把 skills/ 目录自动挂载为 MCP resources（MCPP 3.4 通道 B 的
 * 参考实现：实时 readdir 投影，新增 skill 无需重启 server）。
 *
 * 暴露入口（对应 S2/S3）：
 *   - `skill://{skillName}/SKILL.md` —— 单个 SKILL.md 全文（text/markdown）
 *   - `resources/list` 经模板 list 回调枚举全部 skill（自动发现）
 *
 * 挂载要点：list/read 不做启动期快照，每次访问实时 readdir + frontmatter 解析
 * + name 白名单校验（防路径穿越，S10 的文件不越界）。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    McpServer,
    ResourceTemplate,
    ResourceNotFoundError,
} from "@modelcontextprotocol/server";
import { isValidSkillName } from "../types.ts";
import { scanSkillsDir } from "./scan.ts";
import { firstTemplateVar } from "./skill-uri.ts";

export interface ResourceForSkillsOptions {
    /** skills 目录（必传：SDK 不假定宿主仓库布局）。 */
    skillsDir: string;
    /** 资源名描述前缀，默认 "skill:{skillName}"。 */
    namePrefix?: string;
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
    const { skillsDir, namePrefix = "skill" } = options;
    const uri = (name: string) => `skill://${name}/SKILL.md`;
    const descriptionFor = (name: string, d?: string) => d ?? `${namePrefix}:${name}`;

    server.registerResource(
        "skill",
        new ResourceTemplate(uri("{skillName}"), {
            list: async () => {
                const skills = await scanSkillsDir(skillsDir);
                return {
                    resources: skills.map((s) => ({
                        uri: s.uri,
                        name: s.name,
                        description:
                            s.frontmatter.description ??
                            descriptionFor(s.name),
                        mimeType: "text/markdown",
                        size: s.size,
                    })),
                };
            },
        }),
        {
            title: `${namePrefix} skill`,
            description: "A single skill under skills/ with its SKILL.md",
            mimeType: "text/markdown",
        },
        async (u, variables) => {
            // 模板变量类型较宽（string | string[]），单段模板实际匹配到 string
            const name = firstTemplateVar(variables.skillName);
            if (!isValidSkillName(name)) {
                throw new ResourceNotFoundError(
                    u.href,
                    `Invalid skill name '${name}'`,
                );
            }
            try {
                const text = await readFile(
                    join(skillsDir, name, "SKILL.md"),
                    "utf-8",
                );
                return {
                    contents: [
                        { uri: u.href, mimeType: "text/markdown", text },
                    ],
                };
            } catch {
                throw new ResourceNotFoundError(
                    u.href,
                    `Skill '${name}' not found`,
                );
            }
        },
    );
}