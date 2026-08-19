/**
 * Skill Resource 的构建期收集与 registry 源码生成。
 *
 * 该模块只能在有本地文件系统的构建阶段调用。生成后的 `StaticSkillResourceFile[]`
 * 应交给 `ResourceForStaticSkills`，从而让 Worker 在运行时无需访问宿主目录。
 */
import {
    readSkillResourceFile,
    scanSkillResourceFiles,
    type SkillResourceScanOptions,
} from "./skill-files.ts";
import type { StaticSkillResourceFile } from "./static-skills.ts";

/** 在构建期读取全部已经通过公开与内容校验的 Skill Resource。 */
export async function buildStaticSkillResources(
    skillsDir: string,
    options?: SkillResourceScanOptions,
): Promise<StaticSkillResourceFile[]> {
    const files = await scanSkillResourceFiles(skillsDir, options);
    const resources: StaticSkillResourceFile[] = [];
    for (const file of files) {
        const content = await readSkillResourceFile(skillsDir, file.skillName, file.relativePath, options);
        if (!content) {
            throw new Error(`MCPP static skill build: '${file.uri}' changed or failed validation while bundling`);
        }
        resources.push({
            ...file,
            text: content.text,
            blob: content.blob,
        });
    }
    return resources;
}

/**
 * 生成可直接提交到应用源码的静态 registry 模块。exportName 必须是 TypeScript
 * 标识符，避免把构建命令参数拼接为任意源码。
 */
export function renderStaticSkillResourcesModule(
    resources: readonly StaticSkillResourceFile[],
    exportName: string = "STATIC_SKILL_RESOURCES",
): string {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportName)) {
        throw new Error("MCPP static skill build: exportName must be a TypeScript identifier");
    }
    return [
        "/** This file is generated at build time. Do not edit manually. */",
        'import type { StaticSkillResourceFile } from "@peri-code/mcpp/skills/static";',
        "",
        `export const ${exportName}: readonly StaticSkillResourceFile[] = ` +
            `${JSON.stringify(resources, null, 4)};`,
        "",
    ].join("\n");
}
