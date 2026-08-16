/**
 * skill:// URI 编解码（MCPP 规范 4.3）。
 *
 * 约定：`skill://{prefix/}{skillName}/{path}`，末段 == frontmatter name（S2）。
 * 单段形态 `skill://{skillName}/SKILL.md` 为 SKILL.md 的恒寻址（S2/S3）。
 * 多段（prefix + 嵌套文件）用于 skill 目录服务者（4.4），相对路径以 skill 根解析（S10）。
 */
import { SKILL_URI_TEMPLATE } from "../types.ts";

export interface ParsedSkillUri {
    /** 完整 uri（原样）。 */
    uri: string;
    /** 前缀部分（skill:// 与 skill 名之间的段，可为空）。 */
    prefix: string;
    /** skill 名（skill:// 后的第一个段）。 */
    skillName: string;
    /** skill 根之后的相对路径（"" 表示根或未提供路径）。 */
    path: string;
}

/** 构造单段 SKILL.md 的恒寻址 URI。 */
export function skillUri(skillName: string): string {
    return `skill://${skillName}/SKILL.md`;
}

/** 构造带嵌套路径的 skill 资源 URI（skill program 引用 references/scripts 等）。 */
export function skillFileUri(skillName: string, path: string): string {
    const clean = path.replace(/^\/+/, "");
    return clean ? `skill://${skillName}/${clean}` : skillUri(skillName);
}

/**
 * 解析 skill:// URI。
 * 仅按结构解析；拒绝 scheme 不符或缺少 skill 名的输入（返回 undefined）。
 */
export function parseSkillUri(uri: string): ParsedSkillUri | undefined {
    const m = /^skill:\/\/([^/]+)(?:\/(.*))?$/.exec(uri);
    if (!m) return undefined;
    const skillName = m[1] ?? "";
    const rest = m[2] ?? "";
    if (!skillName) return undefined;
    const prefix = "";
    const path = rest;
    return { uri, prefix, skillName, path };
}

/** resource 模板变量提取：单段模板匹配到 string，多段可能为 string[]。 */
export function firstTemplateVar(value: string | string[] | undefined): string {
    if (Array.isArray(value)) return value[0] ?? "";
    return value ?? "";
}

/** SKILL_URI_TEMPLATE 元信息（供 README / 文档引用）。 */
export { SKILL_URI_TEMPLATE };